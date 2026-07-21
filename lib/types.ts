import { Constants, type Tables } from "./database.types";

/**
 * Row types, derived from the live database schema. Regenerate
 * `database.types.ts` after any migration rather than editing these by hand.
 */
export type Product = Tables<"products">;
export type Category = Tables<"categories">;
export type ProductRestock = Tables<"product_restocks">;
export type Service = Tables<"services">;
export type ServiceTransaction = Tables<"service_transactions">;
export type VaultEntry = Tables<"vault_entries">;
export type Transaction = Tables<"transactions">;
export type TransactionItem = Tables<"transaction_items">;

/** A transaction with its line items, as returned by the dashboard query. */
export type TransactionWithItems = Transaction & {
  transaction_items: TransactionItem[];
};

export type VaultEntryType = VaultEntry["entry_type"];

export const VAULT_ENTRY_TYPE_LABELS: Record<VaultEntryType, string> = {
  sale: "Sale",
  service: "Service",
  deposit: "Cash in",
  withdrawal: "Cash out",
  count: "Count",
};

/** The three places money lives: the physical box and the two wallets. */
export const MONEY_ACCOUNTS = Constants.public.Enums.money_account;

export type MoneyAccount = (typeof MONEY_ACCOUNTS)[number];

export const MONEY_ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  cash: "Cash box",
  gcash: "GCash",
  maya: "Maya",
};

export function isMoneyAccount(value: string): value is MoneyAccount {
  return (MONEY_ACCOUNTS as readonly string[]).includes(value);
}

/**
 * A payment method IS the money account the money lands in — one concept,
 * one enum (unified in migration 0008). "Cash box" is the account label;
 * at the point of payment it reads simply "Cash".
 */
export const PAYMENT_METHODS = MONEY_ACCOUNTS;

export type PaymentMethod = MoneyAccount;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
};

/**
 * Dashboard filters. "all" is a UI-only concept meaning "don't filter" — it is
 * deliberately not a payment method and must never be sent to the database.
 */
export const TRANSACTION_FILTERS = ["all", ...PAYMENT_METHODS] as const;

export type TransactionFilter = (typeof TRANSACTION_FILTERS)[number];

export const TRANSACTION_FILTER_LABELS: Record<TransactionFilter, string> = {
  all: "All",
  cash: "Store",
  gcash: "GCash",
  maya: "Maya",
};
