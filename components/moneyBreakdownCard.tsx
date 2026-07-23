"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BreakdownRow = {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Indented child rows under this one (e.g. E-Service split by wallet). */
  subRows?: BreakdownRow[];
};

/**
 * Shared shape for the dashboard's "hero total + proportion bar + per-account
 * rows" cards (money on hand, sales by channel, …). A proportion bar is only
 * meaningful over non-negative amounts, so it hides itself if any row has
 * gone negative (an oversold/odd state) — the rows still show the true
 * (signed) figures underneath.
 *
 * The total (title + big number + subtitle) always stays visible; tapping it
 * collapses the bar + row breakdown, so the headline figure is still glance-
 * able even collapsed.
 */
export function MoneyBreakdownCard({
  title,
  subtitle,
  total,
  rows,
  href,
  linkLabel = "View →",
  className,
}: {
  title: string;
  subtitle?: string;
  total: number;
  rows: BreakdownRow[];
  /** If set, a small link to view the full breakdown elsewhere. */
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  // Collapsed by default — the headline total is the thing worth seeing at
  // a glance on the dashboard; the breakdown is a tap away.
  const [collapsed, setCollapsed] = useState(true);

  const barTotal = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const showBar = barTotal > 0 && rows.every((row) => row.value >= 0);

  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        {href ? (
          <Button
            variant="ghost"
            size="xs"
            className="-mr-2 text-muted-foreground"
            nativeButton={false}
            render={<Link href={href} />}
          >
            {linkLabel}
          </Button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="mt-1 flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums">
            {formatPeso(total)}
          </span>
          {subtitle ? (
            <span className="mt-0.5 text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </span>
        {collapsed ? (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {!collapsed ? (
        <>
          {showBar ? (
            <div
              aria-hidden
              className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full"
            >
              {rows
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
            {rows.map((row) => (
              <div key={row.key} className="flex flex-col gap-1">
                <p className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      row.value < 0 && "text-destructive"
                    )}
                  >
                    {formatPeso(row.value)}
                  </span>
                </p>

                {row.subRows?.length ? (
                  // Indented under its parent — visually its children, not
                  // the parent's siblings.
                  <div className="ml-5 flex flex-col gap-1 border-l pl-3">
                    {row.subRows.map((subRow) => (
                      <p
                        key={subRow.key}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: subRow.color }}
                          />
                          {subRow.label}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatPeso(subRow.value)}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
