import { MoneyBreakdownCard, type BreakdownRow } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
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
  storeProfit,
  personalTake,
  showIncomeRow = false,
  compact = false,
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
  /** Store's real profit (price - cost). When provided, this — not `store`
      — is what the "Store" row displays (labeled "Store profit"); `store`
      itself is used only for the headline total, which always stays gross.
      Also feeds the "Total profit" line below E-Service (+ E-Service fees,
      already pure profit since the principal is a pass-through). Omit to
      fall back to plain gross everywhere, and skip the profit line. */
  storeProfit?: number;
  /** Value of stock taken out without a sale — shown as its own footer
      line, never folded into `store`/`total`/the proportion bar, since a
      personal take isn't income (see checkoutForm.tsx: no payment method,
      no tender, no income posted for one). Omitted (or 0) hides the line. */
  personalTake?: number;
  /** Adds an explicit "Income" row in the footer, right above "Total
      profit" — the same gross figure the headline already shows, just
      named. Off by default (the headline number already IS this, no need
      to repeat it in most places this card appears); the Vault snapshot
      sheet turns it on so Income and Total profit sit named side by side
      rather than relying on an unlabeled headline. */
  showIncomeRow?: boolean;
  /** Tighter padding and a smaller headline number — see MoneyBreakdownCard. */
  compact?: boolean;
  className?: string;
}) {
  const eServiceTotal = eService.gcash + eService.maya + eService.other;
  // Headline stays gross even when storeProfit is supplied — the profit
  // view lives in the "Store" row label/value and the footer below, not the
  // big number up top.
  const total = store + eServiceTotal;
  const totalProfit =
    storeProfit !== undefined ? storeProfit + eServiceTotal : undefined;

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
    {
      key: "store",
      label: storeProfit !== undefined ? "Store profit" : storeLabel,
      value: storeProfit !== undefined ? storeProfit : store,
      color: STORE_COLOR,
    },
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
      footer={
        showIncomeRow || totalProfit !== undefined || (personalTake ?? 0) > 0 ? (
          <div className="flex flex-col gap-1">
            {showIncomeRow ? (
              <p className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground">
                  Income
                </span>
                <span className="font-semibold tabular-nums">
                  {formatPeso(total)}
                </span>
              </p>
            ) : null}
            {totalProfit !== undefined ? (
              <p className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground">
                  Total profit
                </span>
                <span className="font-semibold tabular-nums">
                  {formatPeso(totalProfit)}
                </span>
              </p>
            ) : null}
            {(personalTake ?? 0) > 0 ? (
              <p className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Personal take</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatPeso(personalTake ?? 0)}
                </span>
              </p>
            ) : null}
          </div>
        ) : undefined
      }
      compact={compact}
      className={className}
    />
  );
}
