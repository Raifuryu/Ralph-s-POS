import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import { formatPeso, rangeSubtitle, storeDayKey } from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import { type MoneyAccount, type VaultEntryType } from "@/lib/types";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import DailySnapshotSheet, { type DailySnapshot } from "./dailySnapshotSheet";
import PersonalTakesSheet, { type PersonalTake } from "./personalTakesSheet";
import VaultLedgerClient from "./vaultLedgerClient";

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

/**
 * Reduces the raw vault ledger + daily profit aggregates into one row per
 * day that had any activity — newest first. `totalMoney` is a genuine
 * running balance, not a per-day movement: replays every vault_entries row
 * in order (a 'count' row resets that account outright, same as
 * vault_balance's own "last count + movements since" definition; anything
 * else just adds/subtracts, entry_type already encodes the sign), snapshots
 * the combined 3-account total after each entry, and keeps only the last
 * snapshot of each day. A day with zero vault movement (e.g. only a fully
 * discounted sale, which posts no vault_entries row per checkout()'s own
 * comment) still gets a row if it shows up in the profit maps, carrying
 * forward the prior day's balance rather than showing a misleading 0.
 */
function buildDailySnapshots(
  vaultEntries: {
    account: MoneyAccount;
    amount: number;
    entry_type: VaultEntryType;
    created_at: string;
  }[],
  marginByDay: Map<string, number>,
  feeByDay: Map<string, number>
): DailySnapshot[] {
  const balances: Record<MoneyAccount, number> = { cash: 0, gcash: 0, maya: 0 };
  const totalByDay = new Map<string, number>();
  for (const entry of vaultEntries) {
    if (entry.entry_type === "count") {
      balances[entry.account] = Number(entry.amount);
    } else {
      balances[entry.account] += Number(entry.amount);
    }
    const day = storeDayKey(entry.created_at);
    totalByDay.set(day, balances.cash + balances.gcash + balances.maya);
  }

  const allDays = new Set<string>([
    ...totalByDay.keys(),
    ...marginByDay.keys(),
    ...feeByDay.keys(),
  ]);
  const sortedDays = [...allDays].sort();

  let carry = 0;
  const rows: DailySnapshot[] = [];
  for (const day of sortedDays) {
    if (totalByDay.has(day)) carry = totalByDay.get(day)!;
    rows.push({
      day,
      totalMoney: carry,
      profit: (marginByDay.get(day) ?? 0) + (feeByDay.get(day) ?? 0),
    });
  }
  return rows.reverse();
}

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
  let snapshotEntryRows: {
    account: MoneyAccount;
    amount: number;
    entry_type: VaultEntryType;
    created_at: string;
  }[];
  let snapshotMarginRows: { day: string; margin: number }[];
  let snapshotFeeRows: { day: string; fee: number }[];

  try {
    // The three account balances come from vault_balance — an all-time view,
    // independent of this page's date/search filters and pagination.
    [
      balanceRows,
      ledgerPage,
      personalTakeRows,
      storeMarginRows,
      eServiceFeeRows,
      snapshotEntryRows,
      snapshotMarginRows,
      snapshotFeeRows,
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
        // The snapshot sheet's own three queries — deliberately date-filter-
        // and search-independent (unlike everything above): a running
        // balance needs its FULL history to reconstruct correctly, not just
        // whatever window happens to be selected. Only worth fetching when
        // that sheet is actually open, same "don't pay for a query nobody's
        // looking at" reasoning as Personal takes/Restock history. `DATE()`
        // matches storeDayKey's grouping exactly, not just approximately —
        // every pooled connection pins its SESSION time_zone to Manila (see
        // lib/mysql/pool.ts), so a TIMESTAMP column already reads back as
        // Manila wall-clock time here.
        showSnapshot
          ? queryRows<{
              account: MoneyAccount;
              amount: number;
              entry_type: VaultEntryType;
              created_at: string;
            }>("SELECT account, amount, entry_type, created_at FROM vault_entries ORDER BY seq ASC")
          : Promise.resolve([]),
        showSnapshot
          ? queryRows<{ day: string; margin: number }>(
              `SELECT DATE(t.created_at) AS day,
                 COALESCE(SUM(
                   CASE WHEN ti.unit_cost IS NOT NULL
                     THEN ti.line_total - ti.unit_cost * ti.quantity
                     ELSE 0
                   END
                 ), 0) AS margin
               FROM transaction_items ti
               JOIN transactions t ON t.id = ti.transaction_id
               WHERE t.is_personal_take = 0 AND t.voided_at IS NULL
               GROUP BY DATE(t.created_at)`
            )
          : Promise.resolve([]),
        showSnapshot
          ? queryRows<{ day: string; fee: number }>(
              `SELECT DATE(created_at) AS day, COALESCE(SUM(fee), 0) AS fee
               FROM service_transactions
               WHERE voided_at IS NULL
               GROUP BY DATE(created_at)`
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

  const dailySnapshots = buildDailySnapshots(
    snapshotEntryRows,
    new Map(snapshotMarginRows.map((row) => [row.day, Number(row.margin)])),
    new Map(snapshotFeeRows.map((row) => [row.day, Number(row.fee)]))
  );

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

      {/* Tap a card to cash in/out of that account — nothing left to pick */}
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
          Daily snapshot
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
      <DailySnapshotSheet open={showSnapshot} snapshots={dailySnapshots} />
    </PageShell>
  );
}
