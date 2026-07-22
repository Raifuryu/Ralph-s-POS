/** Page size shared by every paginated list in the app (sales, vault ledger). */
export const PAGE_SIZE = 20;

/** Parses a `?page=` search param into a 1-based page number, clamped to ≥1. */
export function parsePage(raw: string | undefined): number {
  return Math.max(1, Number.parseInt(raw ?? "1", 10) || 1);
}

/** `.range()` bounds for a Supabase query, from a 1-based page. */
export function pageRange(page: number): { rangeFrom: number; rangeTo: number } {
  const rangeFrom = (page - 1) * PAGE_SIZE;
  return { rangeFrom, rangeTo: rangeFrom + PAGE_SIZE - 1 };
}

/** Total page count from a query's exact row count (available only after it resolves). */
export function pageCountFor(count: number | null): number {
  return Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
}
