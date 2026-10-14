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
