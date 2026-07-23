import { Constants, type Json, type Tables } from "./database.types";

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

/** One amount-based fee tier — e.g. a ₱100–500 load charges ₱10.
    `max: null` means unbounded upward (an "and up" top tier). */
export type FeeTier = { min: number; max: number | null; fee: number };

/** Parses (and silently drops anything malformed from) a service's raw
    `fee_tiers` jsonb column into usable tiers — never throws, since a
    corrupt/unexpected value should just behave like "no tiers configured"
    rather than break the page. */
export function parseFeeTiers(raw: Json): FeeTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: FeeTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const min = Number((item as Record<string, unknown>).min);
    const fee = Number((item as Record<string, unknown>).fee);
    if (!Number.isFinite(min) || !Number.isFinite(fee)) continue;
    const maxRaw = (item as Record<string, unknown>).max;
    const max = maxRaw === null || maxRaw === undefined ? null : Number(maxRaw);
    if (max !== null && !Number.isFinite(max)) continue;
    tiers.push({ min, max, fee });
  }
  return tiers;
}

/** First tier (in array order) whose range contains `amount`, or null if
    none matches — callers typically fall back to a flat default_fee then. */
export function feeForPrincipal(tiers: FeeTier[], amount: number): number | null {
  for (const tier of tiers) {
    if (amount >= tier.min && (tier.max === null || amount <= tier.max)) {
      return tier.fee;
    }
  }
  return null;
}

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
 * The dashboard's main list mixes two different kinds of money-in event —
 * a product sale (`transactions`) and an e-service transaction
 * (`service_transactions`) — into one chronological feed. They render very
 * differently (line items vs. principal/fee), so callers switch on `kind`.
 */
export type SalesEntry =
  | { kind: "sale"; data: TransactionWithItems }
  | { kind: "service"; data: ServiceTransaction };

/**
 * Dashboard category, distinct from payment method: a product sale is
 * "store" revenue no matter how it was paid (cash, GCash, or Maya) — see
 * incomeCardCopy in app/page.tsx for the same reasoning applied to the
 * income card. An e-service is categorized by which wallet it touched
 * instead, since that's the money-flow that actually matters for it.
 */
export type SalesCategory = "store" | "gcash" | "maya" | "other";

export function salesEntryCategory(entry: SalesEntry): SalesCategory {
  if (entry.kind === "sale") return "store";
  if (entry.data.wallet === "gcash") return "gcash";
  if (entry.data.wallet === "maya") return "maya";
  return "other";
}

/**
 * Dashboard filters. "all" is a UI-only concept meaning "don't filter."
 */
export const SALES_FILTERS = ["all", "store", "gcash", "maya", "other"] as const;

export type SalesFilter = (typeof SALES_FILTERS)[number];

export const SALES_FILTER_LABELS: Record<SalesFilter, string> = {
  all: "All",
  store: "Store",
  gcash: "GCash",
  maya: "Maya",
  other: "Other",
};
