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
};
