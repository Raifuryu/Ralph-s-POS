import { EmptyState } from "@/components/emptyState";
import { formatPeso } from "@/lib/format";

export type CategoryRevenue = { key: string; name: string; revenue: number };

/**
 * Ranked list, each row its own proportional bar (width relative to the top
 * row) in a single neutral accent color — deliberately not MoneyBreakdownCard
 * (whose one shared bar only reads correctly with distinct per-row colors).
 * Categories are open-ended and have no validated categorical palette, so a
 * single-color per-row bar avoids ever needing to invent new hues.
 */
export default function CategoryLeaderboard({
  title,
  subtitle,
  categories,
}: {
  title: string;
  subtitle?: string;
  categories: CategoryRevenue[];
}) {
  const max = categories.reduce((m, c) => Math.max(m, c.revenue), 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}

      {categories.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="No sales in this window yet." />
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {categories.map((category) => (
            <div key={category.key} className="flex flex-col gap-1">
              <p className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{category.name}</span>
                <span className="font-medium tabular-nums">
                  {formatPeso(category.revenue)}
                </span>
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${max > 0 ? (category.revenue / max) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
