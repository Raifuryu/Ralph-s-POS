import { PageError, PageShell } from "@/components/pageShell";
import { queryRows } from "@/lib/mysql/pool";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import { type MoneyAccount } from "@/lib/types";
import TransactionFilters from "../transactionFilters";
import AccountSheet from "./accountSheet";
import VaultLedgerClient from "./vaultLedgerClient";

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

type VaultBalanceRow = { account: MoneyAccount; balance: number };

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  from_ts?: string;
  to_ts?: string;
};

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const filters = { q, fromTs: params.from_ts, toTs: params.to_ts };

  let balanceRows: VaultBalanceRow[];
  let ledgerPage: Awaited<ReturnType<typeof fetchVaultLedgerPage>>;

  try {
    // The three account balances come from vault_balance — an all-time view,
    // independent of this page's date/search filters and pagination.
    [balanceRows, ledgerPage] = await Promise.all([
      queryRows<VaultBalanceRow>("SELECT account, balance FROM vault_balance"),
      fetchVaultLedgerPage(filters, 0),
    ]);
  } catch (err) {
    return <PageError title="Could not load the vault" message={(err as Error).message} />;
  }

  const balances = new Map(
    balanceRows
      .filter((row): row is typeof row & { account: MoneyAccount } => row.account !== null)
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

      <VaultLedgerClient
        key={`${q}|${params.from_ts ?? ""}|${params.to_ts ?? ""}`}
        initialEntries={ledgerPage.entries}
        initialTotal={ledgerPage.total}
        filters={filters}
        filtered={Boolean(q || params.from_ts || params.to_ts)}
      />
    </PageShell>
  );
}
