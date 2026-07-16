export const TRANSACTION_CATEGORIES = ["All", "Cash", "E-Wallet"] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];
