import { MoneyBreakdownCard, type BreakdownRow } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS } from "@/lib/accountColors";
import { MONEY_ACCOUNT_LABELS } from "@/lib/types";

/**
 * Colors new to this card, validated together with the existing green/
 * magenta used for GCash/Maya elsewhere (5-swatch set incl. "Other", against
 * the white surface: worst-case CVD ΔE 6.1 — inside the 6-8 floor band,
 * legal because every value here is directly labeled; normal-vision ΔE ≥
 * 16.6). Deliberately NOT the blue/green/pink used for money accounts on the
 * Vault card — "Store" here means product revenue regardless of how it was
 * paid, so reusing "Cash blue" would wrongly imply cash-only.
 *
 * GCash/Maya reuse lib/accountColors.ts (the canonical account→hue mapping)
 * rather than redeclaring their hex values, so a future palette change stays
 * in sync with the Vault card automatically.
 */
// Exported so other range-scoped views (e.g. the statistics page's revenue
// trend chart) can reuse the exact same Store/E-Service meaning rather than
// picking their own colors for the same two concepts.
export const STORE_COLOR = "#4a3aa7"; // violet
export const ESERVICE_COLOR = "#eda100"; // yellow
const OTHER_COLOR = "#1baf7a"; // aqua — wallet-less service fees (e.g. xerox)

export type EServiceFees = {
  gcash: number;
  maya: number;
  /** Fee income from services with no wallet set (e.g. cash-only xerox). */
  other: number;
};

/**
 * Income for the active window, split by SOURCE rather than payment method:
 * Store (product sales, any payment method) vs E-Service (service fee
 * income), with E-Service further broken down by which wallet it touched.
 * Data-shaping wrapper around MoneyBreakdownCard, same role app/vaultCard.tsx
 * plays for the account-balance card.
 */
export default function IncomeBreakdownCard({
  title,
  subtitle,
  store,
  storeLabel = "Store",
  eService,
  className,
}: {
  title: string;
  subtitle?: string;
  store: number;
  /** Callers pass real numbers with different meanings under this same
      "store" slot (gross revenue vs. cost-aware margin) — the label says
      which one this is, defaulting to the plain, meaning-agnostic "Store". */
  storeLabel?: string;
  eService: EServiceFees;
  className?: string;
}) {
  const eServiceTotal = eService.gcash + eService.maya + eService.other;
  const total = store + eServiceTotal;

  const eServiceSubRows: BreakdownRow[] = [
    {
      key: "gcash",
      label: MONEY_ACCOUNT_LABELS.gcash,
      value: eService.gcash,
      color: ACCOUNT_COLORS.gcash,
    },
    {
      key: "maya",
      label: MONEY_ACCOUNT_LABELS.maya,
      value: eService.maya,
      color: ACCOUNT_COLORS.maya,
    },
    ...(eService.other > 0
      ? [{ key: "other", label: "Other", value: eService.other, color: OTHER_COLOR }]
      : []),
  ];

  const rows: BreakdownRow[] = [
    { key: "store", label: storeLabel, value: store, color: STORE_COLOR },
    {
      key: "eservice",
      label: "E-Service",
      value: eServiceTotal,
      color: ESERVICE_COLOR,
      subRows: eServiceSubRows,
    },
  ];

  return (
    <MoneyBreakdownCard
      title={title}
      subtitle={subtitle}
      total={total}
      rows={rows}
      className={className}
    />
  );
}
