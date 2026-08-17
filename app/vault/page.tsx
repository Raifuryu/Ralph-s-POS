import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import { formatPeso, rangeSubtitle } from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import { type MoneyAccount } from "@/lib/types";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import PersonalTakesSheet, { type PersonalTake } from "./personalTakesSheet";
import VaultLedgerClient from "./vaultLedgerClient";
import VaultSnapshotSheet, { type TodaySnapshot } from "./vaultSnapshotSheet";

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

// Personal takes are rare next to restocks/sales — no pagination needed,
// just a generous cap so a years-old store can't make this query unbounded.
const PERSONAL_TAKES_LIMIT = 500;

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
  let ledgerPage: Awaited<ReturnType<typeof fetchVaultLedgerPage>>;
  let personalTakeRows: Omit<PersonalTake, "items">[];
  let storeMarginRows: { store_margin: number }[];
  let eServiceFeeRows: { total_fee: number }[];
  let todaySnapshotRows: TodaySnapshot[];

  try {
    // The three account balances come from vault_balance — an all-time view,
    // independent of this page's date/search filters and pagination.
    [
      balanceRows,
      ledgerPage,
      personalTakeRows,
      storeMarginRows,
      eServiceFeeRows,
      todaySnapshotRows,
    ] = await Promise.all([
        queryRows<VaultBalanceRow>("SELECT account, balance FROM vault_balance"),
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
          `SELECT cash_amount, gcash_amount, maya_amount, total_money, profit, updated_at
           FROM vault_snapshots WHERE snapshot_day = CURDATE()`
        ),
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

  const todaySnapshot: TodaySnapshot | null = todaySnapshotRows[0]
    ? {
        cash_amount: Number(todaySnapshotRows[0].cash_amount),
        gcash_amount: Number(todaySnapshotRows[0].gcash_amount),
        maya_amount: Number(todaySnapshotRows[0].maya_amount),
        total_money: Number(todaySnapshotRows[0].total_money),
        profit: Number(todaySnapshotRows[0].profit),
        updated_at: todaySnapshotRows[0].updated_at,
      }
    : null;

  const balances = new Map(
    balanceRows
      .filter((row): row is typeof row & { account: MoneyAccount } => row.account !== null)
      .map((row) => [row.account, Number(row.balance ?? 0)])
  );
  const totalOnHand = ACCOUNTS.reduce(
    (sum, account) => sum + (balances.get(account) ?? 0),
    0
  );

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
      <VaultSnapshotSheet open={showSnapshot} today={todaySnapshot} />
    </PageShell>
  );
}
