import type { MoneyAccount } from "./types";

/**
 * Fixed account → hue assignment (color follows the entity, never its rank —
 * every card that breaks money down by account uses this same mapping).
 *
 * The app's own chart tokens (--chart-1..5) are grayscale, which fails a
 * categorical palette validation outright (zero chroma, adjacent steps
 * indistinguishable even to normal vision). These three hues are categorical
 * slots 1–3 from a validated palette, re-validated against this app's white
 * surface: CVD ΔE ≥ 7.6, normal-vision ΔE ≥ 29. Maya's pink sits below 3:1
 * contrast, which is legal only because every value using these colors is
 * directly labeled — color never carries identity alone here.
 */
export const ACCOUNT_COLORS: Record<MoneyAccount, string> = {
  cash: "#2a78d6",
  gcash: "#008300",
  maya: "#e87ba4",
};

export const ACCOUNT_ORDER: MoneyAccount[] = ["cash", "gcash", "maya"];
