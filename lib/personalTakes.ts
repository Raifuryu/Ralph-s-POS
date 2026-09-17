import { roundMoney } from "@/lib/pricing";
import type {
  SalesEntry,
  TransactionItem,
  TransactionWithItems,
} from "@/lib/types";

/**
 * A personal take counts as income on the day it's PAID, not the day it was
 * taken — until then it's a debt (tracked in Vault → Personal takes), not a
 * sale. Pure and client-safe, so the dashboard list, the Income card, and
 * Statistics all apply the exact same rule.
 */

/** When an entry "happened" for sorting and day grouping — a paid personal
    take lands on its settled_at, everything else on created_at. */
export function effectiveTimestamp(entry: SalesEntry): string {
  if (entry.kind === "sale" && entry.data.is_personal_take && entry.data.settled_at) {
    return entry.data.settled_at;
  }
  return entry.data.created_at;
}

/** What one line of a paid take counts for as revenue. At cost the debtor
    only reimbursed what the store paid, so a line is worth its cost (or
    nothing, if that cost was never recorded — same as the take's own
    cost-based total, see checkout()). At selling price they paid retail,
    so a line is worth its full line_total. */
export function settledLineRevenue(
  item: TransactionItem,
  atSellingPrice: boolean
): number {
  if (atSellingPrice) return Number(item.line_total ?? 0);
  return item.unit_cost !== null
    ? roundMoney(Number(item.unit_cost) * item.quantity)
    : 0;
}

/** Aggregation-only view of a paid take as an ordinary sale dated on its
    payment day, paid via the settlement account, with each line's revenue
    rewritten per settledLineRevenue. Its unit_cost snapshots are untouched,
    so the usual "revenue − known cost" margin math yields profit only at
    selling price and exactly zero at cost. Never render this — it
    deliberately reports is_personal_take: false so existing sale loops pick
    it up unchanged. Returns null for anything that isn't a paid, non-voided
    take. */
export function asSettledSale(
  take: TransactionWithItems
): TransactionWithItems | null {
  if (
    !take.is_personal_take ||
    !take.settled_at ||
    !take.settlement ||
    take.voided_at
  ) {
    return null;
  }
  const { amount, account, atSellingPrice } = take.settlement;
  return {
    ...take,
    is_personal_take: false,
    created_at: take.settled_at,
    payment_method: account,
    total: amount,
    transaction_items: take.transaction_items.map((item) => ({
      ...item,
      line_total: settledLineRevenue(item, atSellingPrice),
    })),
  };
}

/** Every sale that counts toward income in a window: regular non-take
    sales as-is, plus paid takes rewritten via asSettledSale. Unpaid takes
    drop out entirely. */
export function incomeSales(
  transactions: TransactionWithItems[]
): TransactionWithItems[] {
  return transactions.flatMap((t) => {
    if (!t.is_personal_take) return [t];
    const settled = asSettledSale(t);
    return settled ? [settled] : [];
  });
}
