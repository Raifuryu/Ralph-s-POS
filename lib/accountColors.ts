import type { MoneyAccount } from "./types";

/**
 * Fixed account → hue assignment (color follows the entity, never its rank —
 * every card that breaks money down by account uses this same mapping, so
 * changing it here is the one place that needs to change).
 *
 * Cash/GCash/Maya = yellow/blue/green, per the owner's own request — blue
 * and green are the same two hues this app already used for cash/gcash
 * respectively (just reassigned to gcash/maya), still the CVD-validated
 * pair described below; yellow reuses incomeBreakdownCard.tsx's own
 * ESERVICE_COLOR rather than a freshly invented hex, so every yellow in the
 * app stays the same value. Not independently re-validated for CVD/contrast
 * as a fresh 3-color set the way the original blue/green/pink combination
 * was — every value using these colors is directly labeled regardless, so
 * color never carries identity alone here.
 */
export const ACCOUNT_COLORS: Record<MoneyAccount, string> = {
  cash: "#eda100",
  gcash: "#2a78d6",
  maya: "#008300",
};

export const ACCOUNT_ORDER: MoneyAccount[] = ["cash", "gcash", "maya"];
