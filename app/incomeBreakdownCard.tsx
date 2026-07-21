import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Colors new to this card, validated together with the existing green/
 * magenta used for GCash/Maya elsewhere (5-swatch set incl. "Other", against
 * the white surface: worst-case CVD ΔE 6.1 — inside the 6-8 floor band,
 * legal because every value here is directly labeled; normal-vision ΔE ≥
 * 16.6). Deliberately NOT the blue/green/pink used for money accounts on the
 * Vault card — "Store" here means product revenue regardless of how it was
 * paid, so reusing "Cash blue" would wrongly imply cash-only.
 */
const STORE_COLOR = "#4a3aa7"; // violet
const ESERVICE_COLOR = "#eda100"; // yellow
const GCASH_COLOR = "#008300"; // green — same hue GCash uses everywhere
const MAYA_COLOR = "#e87ba4"; // magenta — same hue Maya uses everywhere
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
 */
export default function IncomeBreakdownCard({
  title,
  subtitle,
  store,
  eService,
  className,
}: {
  title: string;
  subtitle?: string;
  store: number;
  eService: EServiceFees;
  className?: string;
}) {
  const eServiceTotal = eService.gcash + eService.maya + eService.other;
  const total = store + eServiceTotal;

  const topRows = [
    { key: "store", label: "Store", value: store, color: STORE_COLOR },
    {
      key: "eservice",
      label: "E-Service",
      value: eServiceTotal,
      color: ESERVICE_COLOR,
    },
  ];
  const barTotal = topRows.reduce((sum, row) => sum + row.value, 0);

  const subRows = [
    { key: "gcash", label: "GCash", value: eService.gcash, color: GCASH_COLOR },
    { key: "maya", label: "Maya", value: eService.maya, color: MAYA_COLOR },
    ...(eService.other > 0
      ? [{ key: "other", label: "Other", value: eService.other, color: OTHER_COLOR }]
      : []),
  ];

  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {formatPeso(total)}
      </p>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}

      {barTotal > 0 ? (
        <div
          aria-hidden
          className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full"
        >
          {topRows
            .filter((row) => row.value > 0)
            .map((row) => (
              <div
                key={row.key}
                style={{
                  backgroundColor: row.color,
                  width: `${(row.value / barTotal) * 100}%`,
                }}
              />
            ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-1">
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: STORE_COLOR }}
            />
            Store
          </span>
          <span className="font-medium tabular-nums">{formatPeso(store)}</span>
        </p>

        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: ESERVICE_COLOR }}
            />
            E-Service
          </span>
          <span className="font-medium tabular-nums">
            {formatPeso(eServiceTotal)}
          </span>
        </p>

        {/* Indented under E-Service — visually its children, not Store's
            siblings — the wallet breakdown the request specifically asked for. */}
        <div className="ml-5 flex flex-col gap-1 border-l pl-3">
          {subRows.map((row) => (
            <p
              key={row.key}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                {row.label}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatPeso(row.value)}
              </span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
