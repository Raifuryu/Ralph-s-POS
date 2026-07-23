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
            return (
              <div
                key={bucket.key}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <div
                  className="flex w-full min-h-0 flex-1 flex-col-reverse overflow-hidden rounded-sm bg-muted/40"
                  title={`${bucket.label}: ${formatPeso(total)}`}
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
