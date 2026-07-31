import { queryRows } from "@/lib/mysql/pool";
import { escapeLike } from "@/lib/search";
import { type VaultEntry } from "@/lib/types";
import type { LedgerEntry } from "@/app/vault/ledger";

/** Page size for one vault ledger "load more" batch — the table grows
    unbounded over the store's lifetime, so unlike the sales dashboard's
    single-day window this can't be fetched in full up front. */
export const VAULT_LEDGER_PAGE_SIZE = 20;

export type VaultLedgerFilters = {
  q: string;
  fromTs?: string;
  toTs?: string;
};

type LedgerJoinRow = VaultEntry & { service_name: string | null };

/**
 * One page of the vault ledger plus the total matching row count (so the
 * client can compute "N left" for its load-more button) — shared by the
 * initial server-rendered load in app/vault/page.tsx and the loadMoreVaultEntries
 * Server Action every subsequent "Load more" click calls.
 */
export async function fetchVaultLedgerPage(
  filters: VaultLedgerFilters,
  offset: number,
  limit: number = VAULT_LEDGER_PAGE_SIZE
): Promise<{ entries: LedgerEntry[]; total: number }> {
  const q = filters.q.trim();

  // Search matches either the note text or, for service entries, the
  // service's own name — a separate lookup for the latter, same pattern the
  // dashboard uses for item-name search across transaction_items.
  let matchedServiceTxnIds: string[] = [];
  if (q) {
    const matches = await queryRows<{ id: string }>(
      "SELECT id FROM service_transactions WHERE service_name LIKE ?",
      [`%${escapeLike(q)}%`]
    );
    matchedServiceTxnIds = matches.map((row) => row.id);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.fromTs) {
    conditions.push("ve.created_at >= ?");
    params.push(filters.fromTs);
  }
  if (filters.toTs) {
    conditions.push("ve.created_at <= ?");
    params.push(filters.toTs);
  }
  if (q) {
    if (matchedServiceTxnIds.length > 0) {
      conditions.push(
        `(ve.note LIKE ? OR ve.service_transaction_id IN (${matchedServiceTxnIds.map(() => "?").join(",")}))`
      );
      params.push(`%${escapeLike(q)}%`, ...matchedServiceTxnIds);
    } else {
      conditions.push("ve.note LIKE ?");
      params.push(`%${escapeLike(q)}%`);
    }
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countRows, joinedRows] = await Promise.all([
    queryRows<{ count: number }>(
      `SELECT COUNT(*) AS count FROM vault_entries ve ${whereClause}`,
      params
    ),
    queryRows<LedgerJoinRow>(
      `SELECT ve.*, st.service_name AS service_name
       FROM vault_entries ve
       LEFT JOIN service_transactions st ON st.id = ve.service_transaction_id
       ${whereClause}
       ORDER BY ve.seq DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
  ]);

  const entries: LedgerEntry[] = joinedRows.map(({ service_name, ...entry }) => ({
    ...entry,
    service_transactions: service_name !== null ? { service_name } : null,
  }));

  return { entries, total: countRows[0]?.count ?? 0 };
}
