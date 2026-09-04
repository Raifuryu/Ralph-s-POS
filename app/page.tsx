import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import {
  formatPeso,
  friendlyDayLabel,
  storeDateFromKey,
  storeDayKey,
  storeDayRange,
} from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import {
  PROFIT_FUNDS,
  PROFIT_FUND_LABELS,
  SALES_FILTERS,
  type MoneyAccount,
  type Product,
  type ProfitFund,
  type SalesEntry,
  type Service,
  type ServiceTransaction,
  type Transaction,
  type TransactionItem,
  type TransactionWithItems,
} from "@/lib/types";
import { signOut } from "./login/actions";
import DashboardDateFilter from "./dashboardDateFilter";
import IncomeBreakdownCard, { type EServiceFees } from "./incomeBreakdownCard";
import NewSaleDrawer from "./newSaleDrawer";
import VaultCard from "./vaultCard";
import TransactionTabs from "./transactionTabs";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Today's income" / "Yesterday's income" read naturally in the title; any
 * other picked day would not ("Jul 20, 2026's income"), so those fall back
 * to a plain title with the date in the subtitle instead.
 */
function incomeCardCopy({
  dateKey,
  unknownCostNote,
}: {
  dateKey: string;
  /** Set when some of the day's store revenue has no recorded cost yet, so
      Store profit below understates real profit rather than overstating it. */
  unknownCostNote?: string;
}): {
  title: string;
  subtitle?: string;
} {
  const label = friendlyDayLabel(storeDateFromKey(dateKey));
  const isRelative = label === "Today" || label === "Yesterday";
  const parts = [isRelative ? null : label, unknownCostNote ?? null].filter(
    (part): part is string => part !== null
  );
  return {
    title: isRelative ? `${label}'s income` : "Income",
    subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
  };
}

const TRANSACTION_COLUMNS =
  "id, payment_method, cashier_id, total, tendered, created_at, is_personal_take, voided_at, voided_by, void_reason, visit_id";
const TRANSACTION_ITEM_COLUMNS =
  "id, transaction_id, product_id, product_name, unit_price, unit_cost, quantity, discount_amount, line_total";
const PRODUCT_COLUMNS =
  "id, name, price, cost, stock, description, category_id, low_stock_threshold, expiry_date, is_active, created_at, updated_at";
const SERVICE_COLUMNS =
  "id, name, cash_flow, default_fee, fee_tiers, wallet, allowed_payment_accounts, pricing_mode, unit_prices, is_active, created_at, updated_at";

/** Newest-first merge of both money-in event kinds into one feed. */
function sortByCreatedAtDesc(entries: SalesEntry[]): SalesEntry[] {
  return [...entries].sort(
    (a, b) =>
      new Date(b.data.created_at).getTime() -
      new Date(a.data.created_at).getTime()
  );
}

type SearchParams = {
  date?: string;
  tab?: string;
};

function LoadError({ message }: { message: string }) {
  return (
    <PageError
      title="Could not load transactions"
      message={message}
      hint={
        <>
          If this says a table is missing, the schema in{" "}
          <code className="text-xs">mariadb/schema.sql</code> has not been
          applied yet.
        </>
      }
    />
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // The dashboard is a day-at-a-time view — one calendar day, picked via
  // DashboardDateFilter, defaulting to today. Ranges/all-time live on
  // Statistics instead. Garbage/malformed input (a hand-edited URL, a stale
  // bookmark from before the date param existed) falls back to today rather
  // than erroring.
  const today = storeDayKey(new Date());
  const dateKey =
    params.date && DATE_KEY_PATTERN.test(params.date) ? params.date : today;

  const activeTab = SALES_FILTERS.includes(params.tab as (typeof SALES_FILTERS)[number])
    ? (params.tab as (typeof SALES_FILTERS)[number])
    : "all";

  const { fromTs, toTs } = storeDayRange(dateKey);

  let transactions: Transaction[];
  let serviceList: ServiceTransaction[];
  let products: Product[];
  let topSellers: { product_id: string; units_sold: number }[];
  let services: Service[];
  let vaultRows: { account: MoneyAccount; balance: number }[];
  let fundsTransferredOutRows: { fund: ProfitFund; amount: number }[];
  let walletsTransferredOutRows: { wallet_id: string; name: string; amount: number }[];
  let transferredInTodayRows: { account: MoneyAccount; amount: number }[];
  let sales: TransactionWithItems[];

  try {
    [
      transactions,
      serviceList,
      products,
      topSellers,
      services,
      vaultRows,
      fundsTransferredOutRows,
      walletsTransferredOutRows,
      transferredInTodayRows,
    ] = await Promise.all([
        // Sales list: every transaction on the picked day, unpaginated —
        // pagination happens in JS below, after merging with
        // service_transactions into one chronological feed.
        queryRows<Transaction>(
          `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC`,
          [fromTs, toTs]
        ),
        queryRows<ServiceTransaction>(
          "SELECT * FROM service_transactions WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC",
          [fromTs, toTs]
        ),
        queryRows<Product>(
          `SELECT ${PRODUCT_COLUMNS} FROM products WHERE is_active = 1 ORDER BY name`
        ),
        queryRows<{ product_id: string; units_sold: number }>(
          "SELECT product_id, units_sold FROM product_sales_totals ORDER BY units_sold DESC LIMIT 5"
        ),
        queryRows<Service>(
          `SELECT ${SERVICE_COLUMNS} FROM services WHERE is_active = 1 ORDER BY name`
        ),
        queryRows<{ account: MoneyAccount; balance: number }>(
          "SELECT account, balance FROM vault_balance"
        ),
        // The card's own "Today's transfers" footer — how much left each
        // fund via a transfer today (the fund-leaving leg, always paired
        // with a real account-arriving leg — see transferFund's own doc
        // comment, there's no "fund → somewhere else" path). `amount` is
        // negative on this leg, flipped here to read as a plain positive
        // figure.
        queryRows<{ fund: ProfitFund; amount: number }>(
          `SELECT fund, COALESCE(SUM(-amount), 0) AS amount
           FROM vault_entries
           WHERE fund IS NOT NULL AND entry_type = 'transfer' AND DATE(created_at) = CURDATE()
           GROUP BY fund`
        ),
        // Same, for wallets — but a wallet's leaving leg alone can't say
        // where the money actually went (it looks identical whether it
        // reached a real account, a fund, or another wallet), so this
        // joins each leaving leg (`ve`) to its sibling via `transfer_group`
        // and only counts it when that sibling landed on a real account
        // (`arrive.fund IS NULL AND arrive.wallet_id IS NULL`) — see
        // vault_entries.transfer_group's own comment. Only reflects
        // Cash/GCash/Maya-bound transfers now, same scope as
        // transferredInTodayRows below.
        queryRows<{ wallet_id: string; name: string; amount: number }>(
          `SELECT ve.wallet_id, w.name, COALESCE(SUM(-ve.amount), 0) AS amount
           FROM vault_entries ve
           JOIN wallets w ON w.id = ve.wallet_id
           JOIN vault_entries arrive
             ON arrive.transfer_group = ve.transfer_group
             AND arrive.id <> ve.id
             AND arrive.fund IS NULL
             AND arrive.wallet_id IS NULL
           WHERE ve.wallet_id IS NOT NULL AND ve.entry_type = 'transfer' AND ve.amount < 0
             AND DATE(ve.created_at) = CURDATE()
           GROUP BY ve.wallet_id, w.name`
        ),
        // Today's total money that came INTO each account — a transfer's
        // arriving leg plus a plain Cash in (entry_type='deposit', always
        // positive already, see vault_entries' own CHECK) — shown beside
        // each row's balance in VaultCard (see its own `todayTransfersIn`
        // prop, name kept even though it's broader now). `fund IS NULL AND
        // wallet_id IS NULL` used to be enough on its own to isolate a
        // transfer's account-arriving leg (a fund/wallet-leaving leg always
        // has one of those set) — but now that account-to-account transfers
        // exist (transferAccountsToAccount), BOTH of that transfer's legs
        // pass that filter, so `amount > 0` is needed too to drop the
        // source account's own negative leaving leg (which would otherwise
        // show up as money "in" — actually money that left).
        queryRows<{ account: MoneyAccount; amount: number }>(
          `SELECT account, COALESCE(SUM(amount), 0) AS amount
           FROM vault_entries
           WHERE fund IS NULL AND wallet_id IS NULL
             AND entry_type IN ('transfer', 'deposit') AND amount > 0
             AND DATE(created_at) = CURDATE()
           GROUP BY account`
        ),
      ]);

    // transaction_items are a separate query (no PostgREST-style nested
    // select in plain SQL), grouped back onto their parent transaction below.
    const itemsByTxnId = new Map<string, TransactionItem[]>();
    if (transactions.length > 0) {
      const items = await queryRows<TransactionItem>(
        `SELECT ${TRANSACTION_ITEM_COLUMNS} FROM transaction_items WHERE transaction_id IN (${transactions.map(() => "?").join(",")})`,
        transactions.map((t) => t.id)
      );
      for (const item of items) {
        const list = itemsByTxnId.get(item.transaction_id);
        if (list) list.push(item);
        else itemsByTxnId.set(item.transaction_id, [item]);
      }
    }
    sales = transactions.map((t) => ({
      ...t,
      transaction_items: itemsByTxnId.get(t.id) ?? [],
    }));
  } catch (err) {
    return <LoadError message={(err as Error).message} />;
  }

  // One chronological feed, newest first — the two source tables can't share
  // a single DB-level LIMIT/OFFSET the way one table could, so both are
  // fetched in full for the day and merged here. TransactionTabs/
  // TransactionTable reveal it to the cashier a page at a time via
  // "load more", entirely client-side.
  const merged = sortByCreatedAtDesc([
    ...sales.map((t) => ({ kind: "sale" as const, data: t })),
    ...serviceList.map((s) => ({ kind: "service" as const, data: s })),
  ]);

  // Store = all product sales in the window, regardless of payment method —
  // a sale is store revenue whether the customer paid cash, GCash, or Maya.
  // This is the card's headline figure: gross income, not profit. Personal
  // takes and voided sales are excluded here (and from itemsSold below) the
  // same way they're excluded everywhere else — a voided sale had its stock
  // and income both reversed, so it isn't really revenue anymore either.
  const storeTotal = sales.reduce(
    (sum, t) => sum + (t.is_personal_take || t.voided_at ? 0 : Number(t.total)),
    0
  );

  // storeMargin is real profit (price - cost) on the same sales — shown
  // separately as "Total profit" below the gross breakdown, not mixed into
  // the headline above. A line only has a known margin once its product has
  // been restocked through the app at least once (unit_cost is snapshotted
  // from products.cost at sale time). Older/never-restocked lines have no
  // cost recorded, so they're tracked separately and excluded rather than
  // assumed to be 100% margin.
  // storeCogs is the flip side of storeMargin — what those same known-cost
  // lines actually cost to stock (quantity × the unit_cost snapshot from
  // sale time), shown on the card as its own "Invested" line so the reader
  // can see income, invested, and profit as three separate numbers instead
  // of only the netted-together margin.
  let storeMargin = 0;
  let storeCogs = 0;
  let storeRevenueWithUnknownCost = 0;
  for (const t of sales) {
    if (t.is_personal_take || t.voided_at) continue;
    for (const item of t.transaction_items) {
      const lineRevenue = Number(item.line_total);
      if (item.unit_cost !== null) {
        const lineCost = Number(item.unit_cost) * item.quantity;
        storeMargin += lineRevenue - lineCost;
        storeCogs += lineCost;
      } else {
        storeRevenueWithUnknownCost += lineRevenue;
      }
    }
  }

  // E-Service = service fee income, further split by which wallet the
  // service touches. "Other" catches wallet-less services (e.g. printing)
  // paid in cash — still fee income, just not tied to a specific e-wallet.
  // Derived from serviceList (already fetched, same date range) rather than
  // a second query for the same table/window.
  const eServiceFees: EServiceFees = { gcash: 0, maya: 0, other: 0 };
  for (const row of serviceList) {
    if (row.voided_at) continue;
    const fee = Number(row.fee);
    if (row.wallet === "gcash") eServiceFees.gcash += fee;
    else if (row.wallet === "maya") eServiceFees.maya += fee;
    else eServiceFees.other += fee;
  }

  // Same gross figure the Income card's own headline shows (store +
  // e-service, before cost) — recomputed here rather than read back off
  // that card, since it's just these same two numbers already in scope.
  const windowIncome =
    storeTotal + eServiceFees.gcash + eServiceFees.maya + eServiceFees.other;

  const { title: incomeTitle, subtitle: incomeSubtitle } = incomeCardCopy({
    dateKey,
    unknownCostNote:
      storeRevenueWithUnknownCost > 0
        ? `${formatPeso(storeRevenueWithUnknownCost)} in sales has no recorded cost yet`
        : undefined,
  });

  // Live money on hand, straight from the vault ledger (all-time balances —
  // the date filters deliberately do not apply to a balance).
  const vault = new Map<MoneyAccount, number>();
  for (const row of vaultRows) {
    if (row.account) vault.set(row.account, Number(row.balance ?? 0));
  }
  // The Sales dashboard's own "Baseline Fund" total (VaultCard's own
  // Cash+GCash+Maya sum) — fed into the Income card's own "Baseline Fund +
  // Income" footer line below.
  const baselineFundTotal = [...vault.values()].reduce((sum, value) => sum + value, 0);
  const transferredInToday = new Map<MoneyAccount, number>();
  for (const row of transferredInTodayRows) {
    if (row.account) transferredInToday.set(row.account, Number(row.amount ?? 0));
  }

  // The card's own "Today's transfers" footer — Profit/For Restock first,
  // then every wallet with a transfer today, zero-amount ones dropped
  // entirely (see fundsTransferredOutRows/walletsTransferredOutRows' own
  // comments on what this actually measures).
  const fundsTransferredOut = new Map<ProfitFund, number>(
    fundsTransferredOutRows.map((row) => [row.fund, Number(row.amount ?? 0)])
  );
  const transfersOut = [
    ...PROFIT_FUNDS.filter((fund) => (fundsTransferredOut.get(fund) ?? 0) > 0).map(
      (fund) => ({
        key: fund as string,
        label: PROFIT_FUND_LABELS[fund],
        amount: fundsTransferredOut.get(fund)!,
      })
    ),
    ...walletsTransferredOutRows
      .filter((row) => Number(row.amount) > 0)
      .map((row) => ({ key: row.wallet_id, label: row.name, amount: Number(row.amount) })),
  ];

  // Same reasoning as storeMargin: counted over the whole filtered window via
  // `sales`, not just the visible page.
  const itemsSold = sales.reduce(
    (sum, t) =>
      sum +
      (t.is_personal_take || t.voided_at
        ? 0
        : t.transaction_items.reduce((n, item) => n + item.quantity, 0)),
    0
  );

  return (
    <PageShell className="pb-32 sm:pb-8">
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Sales</h1>
          <div className="flex flex-wrap items-center gap-2">
            <NewSaleDrawer
              products={products}
              topProductIds={topSellers
                .map((row) => row.product_id)
                .filter((id): id is string => id !== null)}
              services={services}
              balances={vault}
            />
            <form action={signOut}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        <DashboardDateFilter dateKey={dateKey} />

        {/* Vault (money on hand) and Income (this window, by source) are the
            two headline cards — equal weight, stacked on mobile, side by
            side from sm up. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VaultCard
            title="Baseline Fund"
            balances={vault}
            todayTransfersIn={transferredInToday}
            transfersOut={transfersOut}
            compact
          />
          <IncomeBreakdownCard
            title={incomeTitle}
            subtitle={incomeSubtitle}
            store={storeTotal}
            eService={eServiceFees}
            storeProfit={storeMargin}
            invested={storeCogs}
            compact
          />
        </div>

        {/* Baseline Fund + Income, plain — not another card, just the
            running total those two cards above add up to. One compact line
            (label and figure side by side, pulled up closer to the cards
            with -mt-3) rather than PageShell's own full gap-6 + a stacked
            label/headline — this app is mostly used on mobile, where that
            much room for one summary line is wasted scroll. */}
        <p className="-mt-3 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>Baseline Fund + Income</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatPeso(baselineFundTotal + windowIncome)}
          </span>
        </p>

        <TransactionTabs
          entries={merged}
          activeTab={activeTab}
          dateKey={dateKey}
        />
      </>
    </PageShell>
  );
}
