import type { MoneyAccount } from "@/lib/types";

/** Page size for one vault ledger "load more" batch — the table grows
    unbounded over the store's lifetime, so unlike the sales dashboard's
    single-day window this can't be fetched in full up front. Kept in its own
    DB-free module so VaultLedgerClient (a client component) can import it
    without dragging lib/vault/ledgerQuery.ts's mysql2 dependency into the
    browser bundle. */
export const VAULT_LEDGER_PAGE_SIZE = 20;

export type VaultLedgerFilters = {
  q: string;
  fromTs?: string;
  toTs?: string;
  /** Narrows to entries on these accounts (matched against vault_entries.
      account directly, same field the Ledger table's own Badge already
      shows) — empty means no wallet filter, every account. Several
      selected at once is an OR, not an AND (an entry has exactly one
      account, so "AND" would always match nothing past the first). */
  accounts: MoneyAccount[];
};
