"use client";

import { useState } from "react";

import { EmptyState } from "@/components/emptyState";
import { formatPeso } from "@/lib/format";
import type { TopProduct } from "./topProductsTable";

export type CategoryRevenue = {
  key: string;
  name: string;
  revenue: number;
  items: TopProduct[];
};

/**
 * Ranked list, each row its own proportional bar (width relative to the top
 * row) in a single neutral accent color — deliberately not MoneyBreakdownCard
 * (whose one shared bar only reads correctly with distinct per-row colors).
 * Categories are open-ended and have no validated categorical palette, so a
 * single-color per-row bar avoids ever needing to invent new hues.
 *
 * Clicking a row expands an item-level breakdown beneath it (client-side
 * only — the data for every category's items is already computed
 * server-side, so no extra fetch is needed on click).
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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
          {categories.map((category) => {
            const isExpanded = expandedKey === category.key;
            return (
              <div key={category.key} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedKey(isExpanded ? null : category.key)
                  }
                  aria-expanded={isExpanded}
                  className="flex cursor-pointer flex-col gap-1 rounded-sm text-left"
                >
                  <p className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted-foreground underline decoration-dotted underline-offset-2">
                      {category.name}
                    </span>
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
                </button>

                {isExpanded ? (
                  <div className="mt-1 flex flex-col gap-1 rounded-md bg-muted/40 p-2">
                    {category.items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No item breakdown available.
                      </p>
                    ) : (
                      category.items.map((item) => (
                        <p
                          key={item.key}
                          className="flex items-baseline justify-between gap-2 text-xs"
                        >
                          <span className="truncate text-muted-foreground">
                            {item.name}{" "}
                            <span className="text-[10px]">×{item.units}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {formatPeso(item.revenue)}
                            {item.profit != null ? (
                              <span className="ml-1 text-[10px]">
                                ({item.profit >= 0 ? "+" : "-"}
                                {formatPeso(Math.abs(item.profit))})
                              </span>
                            ) : null}
                          </span>
                        </p>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
