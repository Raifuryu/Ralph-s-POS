"use client";

import { useState } from "react";

import { ESERVICE_COLOR, STORE_COLOR } from "@/app/incomeBreakdownCard";
import { EmptyState } from "@/components/emptyState";
import { formatPeso } from "@/lib/format";
import { SeriesLegend, toggleSeries, type Series } from "./seriesLegend";

export type ProfitBucket = {
  key: string;
  label: string;
  /** Store margin (price − cost) for sales in this bucket — not gross
      revenue. Known-cost lines only, same as the Gross profit KPI above. */
  store: number;
  /** E-Service fee income — already pure margin, no COGS to subtract. */
  eService: number;
};

// Fixed per-bar width rather than squeezing every bucket into the card's
// width — a 30-day range at "1/30th of the screen" per bar left no room for
// a label or figure on most bars, and which ones got skipped depended on
// how buckets.length happened to divide, which read as arbitrary. A fixed
// width plus horizontal scroll means every bar always gets its label and
// figure, and swiping through a month is an ordinary phone gesture. Wide
// enough for the compact on-bar figure below ("₱12.3k") without colliding
// with its neighbors.
const BAR_WIDTH_PX = 52;

/** Short on-bar figure — the full centavo-precise formatPeso() would overflow
    a 52px bar and collide with its neighbors once every bar shows one (the
    exact amount is still in the `title` tooltip and everywhere else in the
    app that needs precision, e.g. the tables below this chart). */
function formatPesoCompact(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1000) return `₱${rounded}`;
  const thousands = rounded / 1000;
  return `₱${thousands.toFixed(Number.isInteger(thousands) ? 0 : 1)}k`;
}

/** Hand-rolled stacked bar chart — no charting library in this app, and this
    is simple enough not to need one. Store sits at the base of each bar,
    E-Service on top, using the same STORE_COLOR/ESERVICE_COLOR as
    IncomeBreakdownCard so the meaning stays consistent across the app — the
    stacking is itself the store/e-service breakdown, not a separate table.
    The legend doubles as a filter (see SeriesLegend) — that's the only
    interactivity here, everything else is still just the native `title`
    tooltip. */
export default function ProfitTrendChart({
  title,
  subtitle,
  buckets,
}: {
  title: string;
  subtitle?: string;
  buckets: ProfitBucket[];
}) {
  const [visible, setVisible] = useState<Set<Series>>(
    () => new Set(["store", "eService"])
  );
  const showStore = visible.has("store");
  const showEService = visible.has("eService");
  const maxTotal = buckets.reduce(
    (m, b) =>
      Math.max(m, (showStore ? b.store : 0) + (showEService ? b.eService : 0)),
    0
  );

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <SeriesLegend
          visible={visible}
          onToggle={(series) => setVisible((prev) => toggleSeries(prev, series))}
        />
      </div>

      {maxTotal === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={
              !showStore && !showEService
                ? "Store and E-Service are both hidden — tap the legend to show one."
                : "No profit in this window yet."
            }
          />
        </div>
      ) : (
        <div className="mt-4 -mx-4 overflow-x-auto px-4">
          <div
            className="flex h-36 gap-1"
            style={{ minWidth: `${buckets.length * BAR_WIDTH_PX}px` }}
          >
            {buckets.map((bucket) => {
              const storeValue = showStore ? bucket.store : 0;
              const eServiceValue = showEService ? bucket.eService : 0;
              const total = storeValue + eServiceValue;
              // Where the figure sits inside the track, as a % from the top
              // — right at the top edge of this bar's own fill, not the
              // track's full height, so it reads as "on the bar" for short
              // bars too. Clamped to 85% so the pill never runs past the
              // bottom edge.
              const figureTop = Math.min(
                85,
                Math.max(0, (1 - total / maxTotal) * 100)
              );
              return (
                <div
                  key={bucket.key}
                  className="flex shrink-0 flex-col items-center gap-1"
                  style={{ width: `${BAR_WIDTH_PX}px` }}
                >
                  <div
                    className="relative h-full w-full overflow-visible rounded-sm bg-muted/40"
                    title={`${bucket.label}: ${formatPeso(total)}`}
                  >
                    <div className="absolute inset-0 overflow-hidden rounded-sm">
                      {storeValue > 0 ? (
                        <div
                          className="absolute inset-x-0 bottom-0"
                          style={{
                            height: `${(storeValue / maxTotal) * 100}%`,
                            backgroundColor: STORE_COLOR,
                          }}
                        />
                      ) : null}
                      {eServiceValue > 0 ? (
                        <div
                          className="absolute inset-x-0"
                          style={{
                            bottom: `${(storeValue / maxTotal) * 100}%`,
                            height: `${(eServiceValue / maxTotal) * 100}%`,
                            backgroundColor: ESERVICE_COLOR,
                          }}
                        />
                      ) : null}
                    </div>
                    {total > 0 ? (
                      <span
                        className="pointer-events-none absolute inset-x-0 flex justify-center"
                        style={{ top: `${figureTop}%` }}
                      >
                        <span className="rounded-sm bg-background px-1 text-[0.6rem] leading-tight font-medium whitespace-nowrap text-foreground shadow">
                          {formatPesoCompact(total)}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-center text-[0.65rem] whitespace-nowrap text-muted-foreground">
                    {bucket.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
