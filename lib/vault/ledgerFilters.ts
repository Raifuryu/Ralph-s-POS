import type { MoneyAccount, ProfitFund } from "@/lib/types";

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
  /** Narrows to entries on these PHYSICAL accounts — `account IN (...)` AND
      `fund IS NULL AND wallet_id IS NULL`, so a fund/wallet's own
      'cash'-placeholder entries don't sneak into a "Cash" filter (see
      vault_entries.account's own placeholder convention). Empty means no
      account filter. Combined with `funds` below as an OR, not an AND — an
      entry is at most one of "on a physical account" or "on a fund", never
      both, so "AND" would always match nothing once both are set. */
  accounts: MoneyAccount[];
  /** Narrows to entries on these funds (`fund IN (...)`) — empty means no
      fund filter. See `accounts`' own comment for how the two combine. */
  funds: ProfitFund[];
  /** Narrows to entries on these owner-created wallets (`wallet_id IN
      (...)`) — empty means no wallet filter. Combines with `accounts`/
      `funds` the same OR way (an entry is on at most one of an account, a
      fund, or a wallet). */
  walletIds: string[];
};
