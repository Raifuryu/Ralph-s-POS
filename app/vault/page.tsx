import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import { formatPeso, rangeSubtitle } from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import { PROFIT_FUNDS, type MoneyAccount, type ProfitFund } from "@/lib/types";
import { type EServiceFees } from "../incomeBreakdownCard";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import FundCard from "./fundCard";
import PersonalTakesSheet, { type PersonalTake } from "./personalTakesSheet";
import VaultLedgerClient from "./vaultLedgerClient";
import VaultSnapshotSheet, {
  type SnapshotHistoryEntry,
  type TodaySnapshot,
} from "./vaultSnapshotSheet";

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

// Personal takes are rare next to restocks/sales — no pagination needed,
// just a generous cap so a years-old store can't make this query unbounded.
const PERSONAL_TAKES_LIMIT = 500;

// One row per day at most (UNIQUE(snapshot_day)) — a year of daily
// snapshots is still a tiny, cheap query, so this cap is just a backstop
// against an unbounded read on a store that's been running for many years.
const SNAPSHOT_HISTORY_LIMIT = 365;

type VaultBalanceRow = { account: MoneyAccount; balance: number };

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  from_ts?: string;
  to_ts?: string;
  debts?: string;
  snapshot?: string;
};

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const filters = { q, fromTs: params.from_ts, toTs: params.to_ts };
  const showDebts = params.debts !== undefined;
  const showSnapshot = params.snapshot !== undefined;

  // Same from_ts/to_ts the ledger below is already filtered by — real
  // profit (price - known cost, plus e-service fees, never gross revenue),
  // same definition Statistics uses. `created_at` is unambiguous in both
  // queries below (transaction_items has no column of that name), so one
  // WHERE fragment/params pair covers both.
  const profitDateConditions: string[] = [];
  const profitDateParams: string[] = [];
  if (params.from_ts) {
    profitDateConditions.push("created_at >= ?");
    profitDateParams.push(params.from_ts);
  }
  if (params.to_ts) {
    profitDateConditions.push("created_at <= ?");
    profitDateParams.push(params.to_ts);
  }
  const profitDateWhere =
    profitDateConditions.length > 0 ? `AND ${profitDateConditions.join(" AND ")}` : "";

  let balanceRows: VaultBalanceRow[];
  let fundBalanceRows: { fund: ProfitFund; balance: number }[];
  let fundBreakdownRows: { fund: ProfitFund; account: MoneyAccount; amount: number }[];
  let ledgerPage: Awaited<ReturnType<typeof fetchVaultLedgerPage>>;
  let personalTakeRows: Omit<PersonalTake, "items">[];
  let storeMarginRows: { store_margin: number }[];
  let eServiceFeeRows: { total_fee: number }[];
  let todaySnapshotRows: TodaySnapshot[];
  let yesterdaySnapshotRows: TodaySnapshot[];
  let todayStoreRows: { gross: number; margin: number }[];
  let todayEServiceRows: { wallet: MoneyAccount | null; fee: number }[];
  let snapshotHistoryRows: {
    snapshot_day: string;
    cash_amount: number;
    gcash_amount: number;
    maya_amount: number;
    total_money: number;
    profit: number;
    income: number | null;
  }[];

  try {
    // The three account balances come from vault_balance — an all-time view,
    // independent of this page's date/search filters and pagination.
    [
      balanceRows,
      fundBalanceRows,
      fundBreakdownRows,
      ledgerPage,
      personalTakeRows,
      storeMarginRows,
      eServiceFeeRows,
      todaySnapshotRows,
      yesterdaySnapshotRows,
      todayStoreRows,
      todayEServiceRows,
      snapshotHistoryRows,
    ] = await Promise.all([
        queryRows<VaultBalanceRow>("SELECT account, balance FROM vault_balance"),
        queryRows<{ fund: ProfitFund; balance: number }>(
          "SELECT fund, balance FROM vault_fund_balance"
        ),
        // "Where this fund's money originally came from" — FundCard's
        // starting suggestion for a transfer, not the fund balance itself
        // (that's vault_fund_balance above, which ignores `account`
        // entirely). HAVING > 0 drops an account a fund never actually
        // touched, or one it's already fully transferred back out of.
        queryRows<{ fund: ProfitFund; account: MoneyAccount; amount: number }>(
          `SELECT fund, account, SUM(amount) AS amount
           FROM vault_entries
           WHERE fund IS NOT NULL
           GROUP BY fund, account
           HAVING SUM(amount) > 0`
        ),
        fetchVaultLedgerPage(filters, 0),
        // Independent of everything above (keyed only by ?debts), and only
        // worth fetching when that sheet is actually open — same "don't pay
        // for a query nobody's looking at" reasoning as Inventory's restock
        // history. Voided takes are excluded — a voided one never happened,
        // there's nothing left to settle.
        showDebts
          ? queryRows<Omit<PersonalTake, "items">>(
              `SELECT id, total, created_at, debtor_name, debtor_description, settled_at
             FROM transactions
             WHERE is_personal_take = 1 AND voided_at IS NULL
             ORDER BY (settled_at IS NULL) DESC, created_at DESC
             LIMIT ${PERSONAL_TAKES_LIMIT}`
            )
          : Promise.resolve([]),
        // Cost-unknown lines (never restocked through the app) are excluded
        // from both sides rather than assumed to be 100% margin — same rule
        // every other profit figure in this app follows.
        queryRows<{ store_margin: number }>(
          `SELECT COALESCE(SUM(
             CASE WHEN ti.unit_cost IS NOT NULL
               THEN ti.line_total - ti.unit_cost * ti.quantity
               ELSE 0
             END
           ), 0) AS store_margin
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.transaction_id
           WHERE t.is_personal_take = 0 AND t.voided_at IS NULL ${profitDateWhere}`,
          profitDateParams
        ),
        queryRows<{ total_fee: number }>(
          `SELECT COALESCE(SUM(fee), 0) AS total_fee
           FROM service_transactions
           WHERE voided_at IS NULL ${profitDateWhere}`,
          profitDateParams
        ),
        // Cheap single-row lookup (UNIQUE(snapshot_day)) — always worth
        // fetching, unlike the ?debts-gated queries above, since it also
        // decides the snapshot button's own label ("Record" vs "Update").
        queryRows<TodaySnapshot>(
          `SELECT cash_amount, gcash_amount, maya_amount, total_money, profit, income, updated_at
           FROM vault_snapshots WHERE snapshot_day = CURDATE()`
        ),
        // Same, one day back — only needed once the sheet's own Today/
        // Yesterday chooser is actually visible, so gated like the rest of
        // the sheet-only queries below.
        showSnapshot
          ? queryRows<TodaySnapshot>(
              `SELECT cash_amount, gcash_amount, maya_amount, total_money, profit, income, updated_at
               FROM vault_snapshots WHERE snapshot_day = CURDATE() - INTERVAL 1 DAY`
            )
          : Promise.resolve([]),
        // The snapshot sheet's own preview — deliberately "today" rather
        // than this page's from/to filter, since the sheet always snapshots
        // right now regardless of what window happens to be selected below.
        // Only worth fetching when that sheet is actually open, same
        // "don't pay for a query nobody's looking at" reasoning as Personal
        // takes. Mirrors the dashboard's own storeTotal/storeMargin split
        // (app/page.tsx) so this preview reads exactly like Sales' own
        // Income card, just always scoped to today.
        showSnapshot
          ? queryRows<{ gross: number; margin: number }>(
              `SELECT
                 COALESCE(SUM(ti.line_total), 0) AS gross,
                 COALESCE(SUM(
                   CASE WHEN ti.unit_cost IS NOT NULL
                     THEN ti.line_total - ti.unit_cost * ti.quantity
                     ELSE 0
                   END
                 ), 0) AS margin
               FROM transaction_items ti
               JOIN transactions t ON t.id = ti.transaction_id
               WHERE t.is_personal_take = 0 AND t.voided_at IS NULL
                 AND DATE(t.created_at) = CURDATE()`
            )
          : Promise.resolve([]),
        showSnapshot
          ? queryRows<{ wallet: MoneyAccount | null; fee: number }>(
              `SELECT wallet, COALESCE(SUM(fee), 0) AS fee
               FROM service_transactions
               WHERE voided_at IS NULL AND DATE(created_at) = CURDATE()
               GROUP BY wallet`
            )
          : Promise.resolve([]),
        // Every past snapshot, newest first — today's own figures are
        // already shown live via the cards above (and won't have settled
        // into a saved row yet if nothing's been recorded today), so this
        // is deliberately "before today," not "every row."
        showSnapshot
          ? queryRows<{
              snapshot_day: string;
              cash_amount: number;
              gcash_amount: number;
              maya_amount: number;
              total_money: number;
              profit: number;
              income: number | null;
            }>(
              `SELECT snapshot_day, cash_amount, gcash_amount, maya_amount, total_money, profit, income
               FROM vault_snapshots
               WHERE snapshot_day < CURDATE()
               ORDER BY snapshot_day DESC
               LIMIT ${SNAPSHOT_HISTORY_LIMIT}`
            )
          : Promise.resolve([]),
      ]);
  } catch (err) {
    return <PageError title="Could not load the vault" message={(err as Error).message} />;
  }

  // Separate query rather than a JOIN on the query above — a JOIN's LIMIT
  // would cap total *rows* (transaction_items included), silently cutting
  // off a take's own item list once enough other takes had items before it.
  // Fetching items for exactly the ids already selected keeps the cap
  // meaning "up to 500 takes," not "up to 500 take/item combinations."
  let personalTakes: PersonalTake[] = personalTakeRows.map((take) => ({
    ...take,
    items: [],
  }));
  if (personalTakeRows.length > 0) {
    try {
      const itemRows = await queryRows<{
        transaction_id: string;
        product_name: string;
        quantity: number;
        unit_price: number;
      }>(
        `SELECT transaction_id, product_name, quantity, unit_price FROM transaction_items
         WHERE transaction_id IN (${personalTakeRows.map(() => "?").join(",")})`,
        personalTakeRows.map((take) => take.id)
      );
      const itemsByTakeId = new Map<
        string,
        { product_name: string; quantity: number; unit_price: number }[]
      >();
      for (const item of itemRows) {
        const list = itemsByTakeId.get(item.transaction_id);
        if (list) list.push(item);
        else itemsByTakeId.set(item.transaction_id, [item]);
      }
      personalTakes = personalTakeRows.map((take) => ({
        ...take,
        items: itemsByTakeId.get(take.id) ?? [],
      }));
    } catch (err) {
      return <PageError title="Could not load the vault" message={(err as Error).message} />;
    }
  }

  const windowProfit =
    Number(storeMarginRows[0]?.store_margin ?? 0) + Number(eServiceFeeRows[0]?.total_fee ?? 0);

  function mapSnapshotRow(row: TodaySnapshot | undefined): TodaySnapshot | null {
    if (!row) return null;
    return {
      cash_amount: Number(row.cash_amount),
      gcash_amount: Number(row.gcash_amount),
      maya_amount: Number(row.maya_amount),
      total_money: Number(row.total_money),
      profit: Number(row.profit),
      income: row.income !== null ? Number(row.income) : null,
      updated_at: row.updated_at,
    };
  }
  const todaySnapshot = mapSnapshotRow(todaySnapshotRows[0]);
  const yesterdaySnapshot = mapSnapshotRow(yesterdaySnapshotRows[0]);

  const balances = new Map(
    balanceRows
      .filter((row): row is typeof row & { account: MoneyAccount } => row.account !== null)
      .map((row) => [row.account, Number(row.balance ?? 0)])
  );
  const totalOnHand = ACCOUNTS.reduce(
    (sum, account) => sum + (balances.get(account) ?? 0),
    0
  );

  const fundBalances = new Map(
    fundBalanceRows.map((row) => [row.fund, Number(row.balance ?? 0)])
  );
  const fundBreakdowns = new Map<ProfitFund, Map<MoneyAccount, number>>();
  for (const row of fundBreakdownRows) {
    let byAccount = fundBreakdowns.get(row.fund);
    if (!byAccount) {
      byAccount = new Map();
      fundBreakdowns.set(row.fund, byAccount);
    }
    byAccount.set(row.account, Number(row.amount));
  }

  const snapshotHistory: SnapshotHistoryEntry[] = snapshotHistoryRows.map((row) => ({
    day: row.snapshot_day,
    cash: Number(row.cash_amount),
    gcash: Number(row.gcash_amount),
    maya: Number(row.maya_amount),
    totalMoney: Number(row.total_money),
    profit: Number(row.profit),
    income: row.income !== null ? Number(row.income) : null,
  }));

  const todayStoreGross = Number(todayStoreRows[0]?.gross ?? 0);
  const todayStoreMargin = Number(todayStoreRows[0]?.margin ?? 0);
  const todayEServiceFees: EServiceFees = { gcash: 0, maya: 0, other: 0 };
  for (const row of todayEServiceRows) {
    const fee = Number(row.fee);
    if (row.wallet === "gcash") todayEServiceFees.gcash += fee;
    else if (row.wallet === "maya") todayEServiceFees.maya += fee;
    else todayEServiceFees.other += fee;
  }

  return (
    <PageShell>
      <h1 className="text-xl font-semibold">Vault</h1>

      {/* Tap a card to cash in/out — or adjust — that account; nothing left
          to pick */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACCOUNTS.map((account) => (
          <AccountSheet
            key={account}
            account={account}
            balance={balances.get(account) ?? 0}
          />
        ))}
      </div>

      {/* Every sale/service fee lands here first, not in the accounts above
          — tap a card to transfer some of it into Cash/GCash/Maya, the only
          way it becomes physically spendable (see mariadb/schema.sql's own
          comment on vault_entries.fund). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PROFIT_FUNDS.map((fund) => (
          <FundCard
            key={fund}
            fund={fund}
            balance={fundBalances.get(fund) ?? 0}
            breakdown={fundBreakdowns.get(fund) ?? new Map()}
          />
        ))}
      </div>

      {/* Total on hand is all-time (same as the three cards above); Profit
          is the one figure here that respects the date filter below, since
          it's the one meant to answer "how much did this window make." */}
      <SummaryCard
        label="Total on hand"
        value={formatPeso(totalOnHand)}
        breakdown={[
          {
            label: `Profit · ${rangeSubtitle(params.from, params.to)}`,
            value: formatPeso(windowProfit),
          },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="self-start"
          nativeButton={false}
          render={<Link href="/vault?debts" />}
        >
          Personal takes
        </Button>
        <Button
          variant="outline"
          className="self-start"
          nativeButton={false}
          render={<Link href="/vault?snapshot" />}
        >
          {todaySnapshot ? "Update snapshot" : "Vault snapshot"}
        </Button>
      </div>

      <TransactionFilters
        initial={{ q, from: params.from ?? "", to: params.to ?? "" }}
        basePath="/vault"
        searchLabel="Search"
        searchPlaceholder="e.g. GCash, supplies"
      />

      <VaultLedgerClient
        key={`${q}|${params.from_ts ?? ""}|${params.to_ts ?? ""}`}
        initialEntries={ledgerPage.entries}
        initialTotal={ledgerPage.total}
        filters={filters}
        filtered={Boolean(q || params.from_ts || params.to_ts)}
      />

      <PersonalTakesSheet open={showDebts} takes={personalTakes} />
      <VaultSnapshotSheet
        open={showSnapshot}
        today={todaySnapshot}
        yesterday={yesterdaySnapshot}
        currentBalances={balances}
        todayStoreGross={todayStoreGross}
        todayStoreMargin={todayStoreMargin}
        todayEServiceFees={todayEServiceFees}
        history={snapshotHistory}
      />
    </PageShell>
  );
}
