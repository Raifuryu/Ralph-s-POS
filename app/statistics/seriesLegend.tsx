"use client";

import { ESERVICE_COLOR, STORE_COLOR } from "@/app/incomeBreakdownCard";
import { cn } from "@/lib/utils";

export type Series = "store" | "eService";

/** Clickable legend — doubles as a filter for ProfitTrendChart and
    HourlyTrafficChart. Each swatch is an independent toggle (not a "solo"
    that hides the other on click), so both/just-store/just-e-service are
    all one or two taps away. Turning both off is allowed on purpose rather
    than guarded against — the chart's own empty state already covers "no
    visible series" for free, no special-casing needed. */
export function SeriesLegend({
  visible,
  onToggle,
}: {
  visible: Set<Series>;
  onToggle: (series: Series) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
      <button
        type="button"
        aria-pressed={visible.has("store")}
        onClick={() => onToggle("store")}
        className={cn(
          "flex items-center gap-1 transition-opacity",
          !visible.has("store") && "opacity-40"
        )}
      >
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ backgroundColor: STORE_COLOR }}
        />
        <span className={cn(!visible.has("store") && "line-through")}>
          Store
        </span>
      </button>
      <button
        type="button"
        aria-pressed={visible.has("eService")}
        onClick={() => onToggle("eService")}
        className={cn(
          "flex items-center gap-1 transition-opacity",
          !visible.has("eService") && "opacity-40"
        )}
      >
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ backgroundColor: ESERVICE_COLOR }}
        />
        <span className={cn(!visible.has("eService") && "line-through")}>
          E-Service
        </span>
      </button>
    </div>
  );
}

export function toggleSeries(prev: Set<Series>, series: Series): Set<Series> {
  const next = new Set(prev);
  if (next.has(series)) next.delete(series);
  else next.add(series);
  return next;
}
