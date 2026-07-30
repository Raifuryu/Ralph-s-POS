import { ESERVICE_COLOR, STORE_COLOR } from "@/app/incomeBreakdownCard";
import { EmptyState } from "@/components/emptyState";

export type HourlyBucket = {
  hour: number;
  label: string;
  store: number;
  eService: number;
};

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
        <div className="mt-4 flex h-36 gap-1">
          {buckets.map((bucket) => {
            const total = bucket.store + bucket.eService;
            return (
              <div
                key={bucket.hour}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <div
                  className="flex w-full min-h-0 flex-1 flex-col-reverse overflow-hidden rounded-sm bg-muted/40"
                  title={`${bucket.label}: ${total} customer${total === 1 ? "" : "s"}`}
                >
                  {bucket.store > 0 ? (
                    <div
                      style={{
                        height: `${(bucket.store / maxTotal) * 100}%`,
                        backgroundColor: STORE_COLOR,
                      }}
                    />
                  ) : null}
                  {bucket.eService > 0 ? (
                    <div
                      style={{
                        height: `${(bucket.eService / maxTotal) * 100}%`,
                        backgroundColor: ESERVICE_COLOR,
                      }}
                    />
                  ) : null}
                </div>
                {/* Every 3rd hour (8 of the 24 bars) so labels never overlap. */}
                <span className="shrink-0 overflow-visible text-center text-[0.65rem] whitespace-nowrap text-muted-foreground">
                  {bucket.hour % 3 === 0 ? bucket.label : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
