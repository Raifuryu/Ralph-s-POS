import { Constants, type Tables } from "./database.types";

/**
 * Row types, derived from the live database schema. Regenerate
 * `database.types.ts` after any migration rather than editing these by hand.
 */
export type Product = Tables<"products">;
export type Transaction = Tables<"transactions">;
export type TransactionItem = Tables<"transaction_items">;

/** A transaction with its line items, as returned by the dashboard query. */
export type TransactionWithItems = Transaction & {
  transaction_items: TransactionItem[];
};

/** Mirrors the `public.payment_method` enum. */
export const PAYMENT_METHODS = Constants.public.Enums.payment_method;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  e_wallet: "E-Wallet",
};

/**
 * Dashboard filters. "all" is a UI-only concept meaning "don't filter" — it is
 * deliberately not a payment method and must never be sent to the database.
 */
export const TRANSACTION_FILTERS = ["all", ...PAYMENT_METHODS] as const;

export type TransactionFilter = (typeof TRANSACTION_FILTERS)[number];

export const TRANSACTION_FILTER_LABELS: Record<TransactionFilter, string> = {
  all: "All",
  ...PAYMENT_METHOD_LABELS,
};

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}
