"use client";

import { useState } from "react";

import { STORE_COLOR } from "@/app/incomeBreakdownCard";
import { EmptyState } from "@/components/emptyState";
import { Select } from "@/components/ui/select";
import { formatHourLabel, WEEKDAY_ORDER } from "@/lib/format";

export type ProductTimeStats = {
  key: string;
  name: string;
  units: number;
  /** Units sold per weekday, Sun-first — index matches WEEKDAY_ORDER. */
  byWeekday: number[];
  /** Units sold per hour of day, 0–23. */
  byHour: number[];
};

/** Single-series version of the stacked bar charts elsewhere on this page
    (ProfitTrendChart, HourlyTrafficChart) — same fixed-width/horizontal-
    scroll/on-bar-figure recipe, just one color since there's only one
    series (units of this one product) instead of a store/e-service split. */
function MiniBarChart({
  buckets,
  barWidthPx,
}: {
  buckets: { key: string; label: string; value: number }[];
  barWidthPx: number;
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.value), 0);

  if (max === 0) {
    return <EmptyState title="No sales in this window yet." />;
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div
        className="flex h-28 gap-1"
        style={{ minWidth: `${buckets.length * barWidthPx}px` }}
      >
        {buckets.map((bucket) => {
          const heightPct = (bucket.value / max) * 100;
          const figureTop = Math.min(85, Math.max(0, 100 - heightPct));
          return (
            <div
              key={bucket.key}
              className="flex shrink-0 flex-col items-center gap-1"
              style={{ width: `${barWidthPx}px` }}
            >
              <div
                className="relative h-full w-full overflow-visible rounded-sm bg-muted/40"
                title={`${bucket.label}: ${bucket.value}`}
              >
                <div className="absolute inset-0 overflow-hidden rounded-sm">
                  {bucket.value > 0 ? (
                    <div
                      className="absolute inset-x-0 bottom-0"
                      style={{ height: `${heightPct}%`, backgroundColor: STORE_COLOR }}
                    />
                  ) : null}
                </div>
                {bucket.value > 0 ? (
                  <span
                    className="pointer-events-none absolute inset-x-0 flex justify-center"
                    style={{ top: `${figureTop}%` }}
                  >
                    <span className="rounded-sm bg-background px-1 text-[0.6rem] leading-tight font-medium whitespace-nowrap text-foreground shadow">
                      {bucket.value}
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
  );
}

/** Index of the largest value in a bucket array — "which day/hour sells
    this product best." Ties keep the first (earliest) index, same as
    Array#reduce's natural left-to-right resolution. */
function peakIndex(buckets: number[]): number {
  return buckets.reduce((best, v, i) => (v > buckets[best] ? i : best), 0);
}

/**
 * Per-product "when does this sell" breakdown — a plain `<select>` (native,
 * not a custom dropdown, same one-handed-mobile reasoning as
 * components/ui/select.tsx) to pick one product, then its units broken down
 * by day of week and by hour of day for the active date range. Every
 * product that sold at all in the window is selectable, sorted by units so
 * the top seller is the default.
 */
export default function ProductAnalysis({
  products,
}: {
  products: ProductTimeStats[];
}) {
  const [selectedKey, setSelectedKey] = useState(products[0]?.key);
  const selected = products.find((p) => p.key === selectedKey) ?? products[0];

  if (!selected) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">Product analysis</p>
        <div className="mt-3">
          <EmptyState title="No sales in this window yet." />
        </div>
      </div>
    );
  }

  const weekdayBuckets = WEEKDAY_ORDER.map((label, i) => ({
    key: label,
    label,
    value: selected.byWeekday[i],
  }));
  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour),
    label: formatHourLabel(hour),
    value: selected.byHour[hour],
  }));
  const bestWeekday = WEEKDAY_ORDER[peakIndex(selected.byWeekday)];
  const bestHour = formatHourLabel(peakIndex(selected.byHour));

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">Product analysis</p>

      <Select
        aria-label="Product to analyze"
        className="mt-3"
        value={selected.key}
        onChange={(event) => setSelectedKey(event.target.value)}
      >
        {products.map((product) => (
          <option key={product.key} value={product.key}>
            {product.name} ({product.units} sold)
          </option>
        ))}
      </Select>

      <p className="mt-3 text-xs text-muted-foreground">
        Busiest: <span className="font-medium text-foreground">{bestWeekday}</span>
        {" · "}
        <span className="font-medium text-foreground">{bestHour}</span>
      </p>

      <p className="mt-4 mb-1 text-xs font-medium text-muted-foreground">
        By day of week
      </p>
      <MiniBarChart buckets={weekdayBuckets} barWidthPx={44} />

      <p className="mt-4 mb-1 text-xs font-medium text-muted-foreground">
        By time of day
      </p>
      <MiniBarChart buckets={hourBuckets} barWidthPx={40} />
    </div>
  );
}
