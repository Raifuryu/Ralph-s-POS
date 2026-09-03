import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import {
  PROFIT_FUNDS,
  type MoneyAccount,
  type ProfitFund,
  type WalletBalance,
} from "@/lib/types";
import { type EServiceFees } from "../incomeBreakdownCard";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import AddWalletSheet from "./addWalletSheet";
import FundCard from "./fundCard";
import PersonalTakesSheet, { type PersonalTake } from "./personalTakesSheet";
import VaultLedgerClient from "./vaultLedgerClient";
import VaultSnapshotSheet, {
  type SnapshotHistoryEntry,
  type TodaySnapshot,
} from "./vaultSnapshotSheet";
import WalletCard from "./walletCard";
import WalletFilter from "./walletFilter";

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
  /** Comma-joined MoneyAccount values — see WalletFilter's own comment. */
  account?: string;
  /** Comma-joined ProfitFund values — see WalletFilter's own comment. */
  fund?: string;
  /** Comma-joined wallet ids — see WalletFilter's own comment. */
  wallet?: string;
};

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  // Garbage/stale values (a hand-edited URL) are silently dropped rather
  // than erroring — same "fall back to no filter" tolerance every other
  // URL-driven filter in this app follows.
  const selectedAccounts = (params.account?.split(",") ?? []).filter(
    (value): value is MoneyAccount => (ACCOUNTS as string[]).includes(value)
  );
  const selectedFunds = (params.fund?.split(",") ?? []).filter(
    (value): value is ProfitFund => (PROFIT_FUNDS as readonly string[]).includes(value)
  );
  // Not validated against the real wallet list here (that's fetched further
  // down) — an id that doesn't actually exist just matches nothing in the
  // query below, same "hand-edited URL" tolerance every other filter here
  // follows.
  const selectedWalletIds = (params.wallet?.split(",") ?? []).filter(
    (value) => value.trim() !== ""
  );
  const filters = {
    q,
    fromTs: params.from_ts,
    toTs: params.to_ts,
    accounts: selectedAccounts,
    funds: selectedFunds,
    walletIds: selectedWalletIds,
  };
  const showDebts = params.debts !== undefined;
  const showSnapshot = params.snapshot !== undefined;

  let balanceRows: VaultBalanceRow[];
  let fundBalanceRows: { fund: ProfitFund; balance: number }[];
  let fundBreakdownRows: { fund: ProfitFund; account: MoneyAccount; amount: number }[];
  let todayFundRows: { fund: ProfitFund; amount: number }[];
  let walletBalanceRows: WalletBalance[];
  let ledgerPage: Awaited<ReturnType<typeof fetchVaultLedgerPage>>;
  let personalTakeRows: Omit<PersonalTake, "items">[];
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
      todayFundRows,
      walletBalanceRows,
      ledgerPage,
      personalTakeRows,
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
        // What each fund actually EARNED today — 'sale'/'service' entries,
        // same entry types checkout.ts/recordService.ts post the
        // profit/reinvest split with, PLUS 'void' — the reversing row
        // voidTransaction.ts/voidServiceTransaction.ts post for one voided
        // same-day (see their own 'void' inserts). Without 'void' here, a
        // sale voided the same day it was made kept its original profit
        // counted with no offsetting reversal, disagreeing with the
        // dashboard's own Income card (Invested/Total profit), which drops
        // a voided transaction entirely. 'transfer'/'withdrawal'/
        // 'adjustment'/'deposit' stay excluded — a same-day cash-out,
        // adjustment, or transfer also touches these funds but isn't
        // income. Un-gated (unlike the snapshot-only queries below) —
        // FundCard always shows this once the card itself renders.
        queryRows<{ fund: ProfitFund; amount: number }>(
          `SELECT fund, COALESCE(SUM(amount), 0) AS amount
           FROM vault_entries
           WHERE fund IS NOT NULL
             AND entry_type IN ('sale', 'service', 'void')
             AND DATE(created_at) = CURDATE()
           GROUP BY fund`
        ),
        // Every owner-created wallet, active or archived, with its balance
        // in the same row — WalletCard's own grid shows all of them
        // (archiving isn't deletion, see wallets' own comment); pickers
        // elsewhere (AccountSheet's Transfer tab, the restock payment
        // sheet) filter this down to is_active themselves.
        queryRows<WalletBalance>(
          "SELECT wallet_id, name, color, is_active, balance FROM wallet_balance ORDER BY name"
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
  const todayFundTotals = new Map(
    todayFundRows.map((row) => [row.fund, Number(row.amount ?? 0)])
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

  const wallets = walletBalanceRows.map((row) => ({
    id: row.wallet_id,
    name: row.name,
    color: row.color,
    is_active: row.is_active,
    balance: Number(row.balance ?? 0),
  }));
  // Active only — an archived wallet drops out of every picker (see
  // wallets' own comment in mariadb/schema.sql), though its own card below
  // still shows regardless.
  const activeWallets = wallets.filter((wallet) => wallet.is_active);
  const walletBalances = new Map(wallets.map((wallet) => [wallet.id, wallet.balance]));
  // Every wallet, active or archived — an archived one's leftover balance is
  // still real money the store has, see wallets' own comment on what
  // is_active does (and doesn't) mean.
  const walletsTotal = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);
  const fundsTotal = PROFIT_FUNDS.reduce(
    (sum, fund) => sum + (fundBalances.get(fund) ?? 0),
    0
  );
  // Everything the store has, across every account/fund/wallet — shown
  // beside the page's own title.
  const grandTotal = totalOnHand + fundsTotal + walletsTotal;

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
      {/* The grand total — every account, fund, and wallet added together —
          sits right beside the title, so "how much does the store have,
          period" is answered before scrolling past a single card. */}
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Vault</h1>
        <p className="text-lg font-semibold tabular-nums">
          {formatPeso(grandTotal)}
        </p>
      </div>

      {/* Tap a card to cash in/out, adjust, or transfer into that account;
          nothing left to pick */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACCOUNTS.map((account) => (
          <AccountSheet
            key={account}
            account={account}
            balance={balances.get(account) ?? 0}
            fundBalances={fundBalances}
            wallets={activeWallets}
            walletBalances={walletBalances}
          />
        ))}
      </div>

      {/* Total on hand, plain — not another card, since the three account
          cards above already carry that weight; this is just the running
          total those three numbers add up to. */}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Total on hand</p>
        <p className="text-2xl font-semibold tabular-nums">
          {formatPeso(totalOnHand)}
        </p>
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
            today={todayFundTotals.get(fund) ?? 0}
            breakdown={fundBreakdowns.get(fund) ?? new Map()}
          />
        ))}
      </div>

      {/* Owner-created wallets beyond the fixed 5 — same "tap to cash in/
          out, adjust, or transfer" card as Profit/For Restock above, plus a
          Manage tab for renaming/archiving. Archived wallets still show
          here (their history stays reachable) but drop out of every other
          picker. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-muted-foreground">Wallets</p>
          <AddWalletSheet />
        </div>
        {wallets.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {wallets.map((wallet) => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  balance={wallet.balance}
                  otherWallets={activeWallets.filter((w) => w.id !== wallet.id)}
                />
              ))}
            </div>

            {/* Same "plain running total below the cards" treatment as
                Total on hand above — not another card, just what the
                wallet cards above already add up to. */}
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Wallets total</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatPeso(walletsTotal)}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No wallets yet — add one to track money for a specific purpose,
            separate from Profit/For Restock.
          </p>
        )}
      </div>

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

      <WalletFilter
        initialAccounts={selectedAccounts}
        initialFunds={selectedFunds}
        initialWalletIds={selectedWalletIds}
        wallets={activeWallets}
        basePath="/vault"
      />

      <VaultLedgerClient
        key={`${q}|${params.from_ts ?? ""}|${params.to_ts ?? ""}|${selectedAccounts.join(",")}|${selectedFunds.join(",")}|${selectedWalletIds.join(",")}`}
        initialEntries={ledgerPage.entries}
        initialTotal={ledgerPage.total}
        filters={filters}
        filtered={Boolean(
          q ||
            params.from_ts ||
            params.to_ts ||
            selectedAccounts.length > 0 ||
            selectedFunds.length > 0 ||
            selectedWalletIds.length > 0
        )}
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
