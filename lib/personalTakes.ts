import { roundMoney } from "@/lib/pricing";
import type { SalesEntry } from "@/lib/types";

/**
 * A personal take never appears in the sales feed itself: it isn't income
 * when it's taken, and a partly-paid one isn't income yet either. Each
 * PAYMENT against it appears instead, on the day it was received — see
 * lib/personalTakesQuery.ts, which derives those payments from the vault
 * deposits recordTakePayment posts.
 */

/** When an entry "happened" for sorting and day grouping. Everything in
    the feed is already dated by when it actually counts (a payment by when
    it was received), so this is just created_at — kept as a named helper
    so the rule has one place to live if that ever stops being true. */
export function effectiveTimestamp(entry: SalesEntry): string {
  return entry.data.created_at;
}

/** Splits one payment across several debts, oldest first, until it runs
    out — the single definition of that rule, used both by the server when
    recording a payment (recordTakePayment) and by the sheet to preview it
    before the owner confirms, so the review can't promise an allocation
    the server wouldn't actually make. Debts with nothing left are skipped;
    anything the debts can't absorb is simply not allocated. */
export function allocatePayment<
  T extends { remaining: number; createdAt: string },
>(takes: T[], amount: number): { take: T; applied: number }[] {
  const allocations: { take: T; applied: number }[] = [];
  let left = roundMoney(amount);
  const oldestFirst = [...takes]
    .filter((take) => take.remaining > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const take of oldestFirst) {
    if (left <= 0) break;
    const applied = roundMoney(Math.min(left, take.remaining));
    if (applied <= 0) continue;
    left = roundMoney(left - applied);
    allocations.push({ take, applied });
  }
  return allocations;
}
