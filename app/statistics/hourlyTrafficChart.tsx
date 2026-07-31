import { ESERVICE_COLOR, STORE_COLOR } from "@/app/incomeBreakdownCard";
import { EmptyState } from "@/components/emptyState";

export type HourlyBucket = {
  hour: number;
  label: string;
  store: number;
  eService: number;
};

// Same reasoning as RevenueTrendChart's BAR_WIDTH_PX — a fixed width plus
// horizontal scroll so every one of the 24 bars gets its own label and
// figure instead of only every 3rd one. Counts are short (1-2 digits), so
// this can be narrower than the peso-figure chart.
const BAR_WIDTH_PX = 40;

/** Same hand-rolled stacked bar chart as RevenueTrendChart, but bucketed by
    hour-of-day (store timezone, always 24 bars) instead of by date, and
    counting transactions/service actions instead of summing revenue — the
    closest proxy this app has for "customers" (there's no separate customer
    entity), matching how the Transactions summary card is already
    computed. */
export default function HourlyTrafficChart({
  title,
  subtitle,
  buckets,
}: {
  title: string;
  subtitle?: string;
  buckets: HourlyBucket[];
}) {
  const maxTotal = buckets.reduce((m, b) => Math.max(m, b.store + b.eService), 0);

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
        <div className="mt-4 -mx-4 overflow-x-auto px-4">
          <div
            className="flex h-36 gap-1"
            style={{ minWidth: `${buckets.length * BAR_WIDTH_PX}px` }}
          >
            {buckets.map((bucket) => {
              const total = bucket.store + bucket.eService;
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
                  key={bucket.hour}
                  className="flex shrink-0 flex-col items-center gap-1"
                  style={{ width: `${BAR_WIDTH_PX}px` }}
                >
                  <div
                    className="relative h-full w-full overflow-visible rounded-sm bg-muted/40"
                    title={`${bucket.label}: ${total} customer${total === 1 ? "" : "s"}`}
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
                    {total > 0 ? (
                      <span
                        className="pointer-events-none absolute inset-x-0 flex justify-center"
                        style={{ top: `${figureTop}%` }}
                      >
                        <span className="rounded-sm bg-background px-1 text-[0.6rem] leading-tight font-medium whitespace-nowrap text-foreground shadow">
                          {total}
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
