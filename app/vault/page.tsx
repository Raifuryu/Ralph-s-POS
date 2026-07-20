import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import Ledger, { type LedgerEntry } from "./ledger";
import VaultForms from "./vaultForms";

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

export default async function VaultPage() {
  const supabase = await createClient();

  const [
    { data: balanceRows, error: balanceError },
    { data: entries, error: entriesError },
  ] = await Promise.all([
    supabase.from("vault_balance").select("account, balance, last_counted_at"),
    supabase
      .from("vault_entries")
      .select("*, service_transactions(service_name)")
      .order("seq", { ascending: false })
      .limit(100)
      .overrideTypes<LedgerEntry[], { merge: false }>(),
  ]);

  const error = balanceError ?? entriesError;
  if (error) {
    return <PageError title="Could not load the vault" message={error.message} />;
  }

  const balances = new Map(
    (balanceRows ?? [])
      .filter(
        (row): row is typeof row & { account: MoneyAccount } =>
          row.account !== null
      )
      .map((row) => [row.account, row])
  );
  const anyCounted = ACCOUNTS.some(
    (account) => balances.get(account)?.last_counted_at
  );

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Vault</h1>
        <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>
          Sales
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACCOUNTS.map((account) => {
          const row = balances.get(account);
          return (
            <div key={account} className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {MONEY_ACCOUNT_LABELS[account]}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatPeso(Number(row?.balance ?? 0))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row?.last_counted_at
                  ? `Counted ${formatDateTime(row.last_counted_at)}`
                  : "Never counted"}
              </p>
            </div>
          );
        })}
      </div>

      {!anyCounted ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          Balances are provisional until you do a first Daily count for each
          account — the count sets the real starting figure.
        </p>
      ) : null}

      <VaultForms />

      <Ledger entries={entries ?? []} />
    </PageShell>
  );
}
