import { Pager } from "@/components/pager";
import { PageError, PageShell } from "@/components/pageShell";
import { PAGE_SIZE, pageCountFor, pageRange, parsePage } from "@/lib/pagination";
import { queryRows } from "@/lib/mysql/pool";
import { escapeLike } from "@/lib/search";
import { type MoneyAccount, type VaultEntry } from "@/lib/types";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import Ledger, { type LedgerEntry } from "./ledger";

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

type VaultBalanceRow = { account: MoneyAccount; balance: number };
type LedgerJoinRow = VaultEntry & { service_name: string | null };

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  from_ts?: string;
  to_ts?: string;
  page?: string;
};

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = parsePage(params.page);
  const { rangeFrom } = pageRange(page);

  let balanceRows: VaultBalanceRow[];
  let joinedRows: LedgerJoinRow[];
  let count: number;

  try {
    // Search matches either the note text or, for service entries, the
    // service's own name — a separate lookup for the latter, same pattern
    // the dashboard uses for item-name search across transaction_items.
    let matchedServiceTxnIds: string[] = [];
    if (q) {
      const matches = await queryRows<{ id: string }>(
        "SELECT id FROM service_transactions WHERE service_name LIKE ?",
        [`%${escapeLike(q)}%`]
      );
      matchedServiceTxnIds = matches.map((row) => row.id);
    }

    const conditions: string[] = [];
    const filterParams: unknown[] = [];
    if (params.from_ts) {
      conditions.push("ve.created_at >= ?");
      filterParams.push(params.from_ts);
    }
    if (params.to_ts) {
      conditions.push("ve.created_at <= ?");
      filterParams.push(params.to_ts);
    }
    if (q) {
      if (matchedServiceTxnIds.length > 0) {
        conditions.push(
          `(ve.note LIKE ? OR ve.service_transaction_id IN (${matchedServiceTxnIds.map(() => "?").join(",")}))`
        );
        filterParams.push(`%${escapeLike(q)}%`, ...matchedServiceTxnIds);
      } else {
        conditions.push("ve.note LIKE ?");
        filterParams.push(`%${escapeLike(q)}%`);
      }
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // The three account balances come from vault_balance — an all-time view,
    // independent of this page's date/search filters and pagination.
    let countRows: { count: number }[];
    [balanceRows, countRows, joinedRows] = await Promise.all([
      queryRows<VaultBalanceRow>("SELECT account, balance FROM vault_balance"),
      queryRows<{ count: number }>(
        `SELECT COUNT(*) AS count FROM vault_entries ve ${whereClause}`,
        filterParams
      ),
      queryRows<LedgerJoinRow>(
        `SELECT ve.*, st.service_name AS service_name
         FROM vault_entries ve
         LEFT JOIN service_transactions st ON st.id = ve.service_transaction_id
         ${whereClause}
         ORDER BY ve.seq DESC
         LIMIT ? OFFSET ?`,
        [...filterParams, PAGE_SIZE, rangeFrom]
      ),
    ]);
    count = countRows[0]?.count ?? 0;
  } catch (err) {
    return <PageError title="Could not load the vault" message={(err as Error).message} />;
  }

  const pageCount = pageCountFor(count);

  const balances = new Map(
    balanceRows
      .filter((row): row is typeof row & { account: MoneyAccount } => row.account !== null)
      .map((row) => [row.account, Number(row.balance ?? 0)])
  );

  const entries: LedgerEntry[] = joinedRows.map(({ service_name, ...entry }) => ({
    ...entry,
    service_transactions: service_name !== null ? { service_name } : null,
  }));

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

      <TransactionFilters
        initial={{ q, from: params.from ?? "", to: params.to ?? "" }}
        basePath="/vault"
        searchLabel="Search"
        searchPlaceholder="e.g. GCash, supplies"
      />

      <Ledger
        entries={entries}
        filtered={Boolean(q || params.from_ts || params.to_ts)}
      />

      <Pager
        page={page}
        pageCount={pageCount}
        basePath="/vault"
        params={{
          q: params.q,
          from: params.from,
          to: params.to,
          from_ts: params.from_ts,
          to_ts: params.to_ts,
        }}
      />
    </PageShell>
  );
}
