import { ESERVICE_COLOR, STORE_COLOR } from "@/app/incomeBreakdownCard";
import { EmptyState } from "@/components/emptyState";
import { formatPeso } from "@/lib/format";

export type RevenueBucket = {
  key: string;
  label: string;
  store: number;
  eService: number;
};

/** Hand-rolled stacked bar chart — no charting library in this app, and this
    is simple enough not to need one. Store sits at the base of each bar,
    E-Service on top, using the same STORE_COLOR/ESERVICE_COLOR as
    IncomeBreakdownCard so the meaning stays consistent across the app. No
    hover interactivity beyond the native `title` tooltip — this is a Server
    Component, kept that way deliberately. */
export default function RevenueTrendChart({
  title,
  subtitle,
  buckets,
}: {
  title: string;
  subtitle?: string;
  buckets: RevenueBucket[];
}) {
  const maxTotal = buckets.reduce((m, b) => Math.max(m, b.store + b.eService), 0);
  // Caps the number of visible date labels so they never overlap — every
  // bar still renders, just not every bar gets a label underneath it.
  const labelStep = Math.max(1, Math.ceil(buckets.length / 5));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: STORE_COLOR }}
            />
            Store
          </span>
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: ESERVICE_COLOR }}
            />
            E-Service
          </span>
        </div>
      </div>

      {maxTotal === 0 ? (
        <div className="mt-3">
          <EmptyState title="No sales in this window yet." />
        </div>
      ) : (
        <div className="mt-4 flex h-36 gap-1">
          {buckets.map((bucket, i) => {
            const total = bucket.store + bucket.eService;
            // Where the figure sits inside the track, as a % from the top —
            // right at the top edge of this bar's own fill, not the track's
            // full height, so it reads as "on the bar" for short bars too.
            // Clamped to 82% so the pill never runs past the bottom edge.
            const showFigure = i % labelStep === 0 && total > 0;
            const figureTop = Math.min(
              85,
              Math.max(0, (1 - total / maxTotal) * 100)
            );
            return (
              <div
                key={bucket.key}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <div
                  className="relative w-full min-h-0 flex-1 overflow-visible rounded-sm bg-muted/40"
                  title={`${bucket.label}: ${formatPeso(total)}`}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-sm">
                    {bucket.store > 0 ? (
                      <div
                        className="absolute inset-x-0 bottom-0"
                        style={{
                          height: `${(bucket.store / maxTotal) * 100}%`,
                          backgroundColor: STORE_COLOR,
                        }}
                      />
                    ) : null}
                    {bucket.eService > 0 ? (
                      <div
                        className="absolute inset-x-0"
                        style={{
                          bottom: `${(bucket.store / maxTotal) * 100}%`,
                          height: `${(bucket.eService / maxTotal) * 100}%`,
                          backgroundColor: ESERVICE_COLOR,
                        }}
                      />
                    ) : null}
                  </div>
                  {/* Same thinning as the date label below — a figure over
                      every one of up to 30 bars would overlap on mobile. */}
                  {showFigure ? (
                    <span
                      className="pointer-events-none absolute inset-x-0 flex justify-center"
                      style={{ top: `${figureTop}%` }}
                    >
                      <span className="rounded-sm bg-background px-1 text-[0.6rem] leading-tight font-medium whitespace-nowrap text-foreground shadow">
                        {formatPeso(total)}
                      </span>
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 overflow-visible text-center text-[0.65rem] whitespace-nowrap text-muted-foreground">
                  {i % labelStep === 0 ? bucket.label : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
