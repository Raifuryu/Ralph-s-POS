import { Pager } from "@/components/pager";
import { PageError, PageShell } from "@/components/pageShell";
import { pageCountFor, pageRange, parsePage } from "@/lib/pagination";
import { escapeLike } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import { type MoneyAccount } from "@/lib/types";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import Ledger, { type LedgerEntry } from "./ledger";

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

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
  const supabase = await createClient();

  // Search matches either the note text or, for service entries, the
  // service's own name — a separate lookup for the latter, same pattern the
  // dashboard uses for item-name search across nested transaction_items.
  let matchedServiceTxnIds: string[] = [];
  if (q) {
    const { data: matches, error: matchError } = await supabase
      .from("service_transactions")
      .select("id")
      .ilike("service_name", `%${escapeLike(q)}%`);

    if (matchError) {
      return <PageError title="Could not load the vault" message={matchError.message} />;
    }
    matchedServiceTxnIds = (matches ?? []).map((row) => row.id);
  }

  const page = parsePage(params.page);
  const { rangeFrom, rangeTo } = pageRange(page);

  let entriesQuery = supabase
    .from("vault_entries")
    .select("*, service_transactions(service_name)", { count: "exact" })
    .order("seq", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (params.from_ts) entriesQuery = entriesQuery.gte("created_at", params.from_ts);
  if (params.to_ts) entriesQuery = entriesQuery.lte("created_at", params.to_ts);
  if (q) {
    const orParts = [`note.ilike.%${escapeLike(q)}%`];
    if (matchedServiceTxnIds.length > 0) {
      orParts.push(`service_transaction_id.in.(${matchedServiceTxnIds.join(",")})`);
    }
    entriesQuery = entriesQuery.or(orParts.join(","));
  }

  // The three account balances come from vault_balance — an all-time view,
  // independent of this page's date/search filters and pagination.
  const [
    { data: balanceRows, error: balanceError },
    { data: entries, error: entriesError, count },
  ] = await Promise.all([
    supabase.from("vault_balance").select("account, balance"),
    entriesQuery.overrideTypes<LedgerEntry[], { merge: false }>(),
  ]);

  const error = balanceError ?? entriesError;
  if (error) {
    return <PageError title="Could not load the vault" message={error.message} />;
  }

  const pageCount = pageCountFor(count);

  const balances = new Map(
    (balanceRows ?? [])
      .filter(
        (row): row is typeof row & { account: MoneyAccount } =>
          row.account !== null
      )
      .map((row) => [row.account, Number(row.balance ?? 0)])
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

      <TransactionFilters
        initial={{ q, from: params.from ?? "", to: params.to ?? "" }}
        basePath="/vault"
        searchLabel="Search"
        searchPlaceholder="e.g. GCash, supplies"
      />

      <Ledger
        entries={entries ?? []}
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
