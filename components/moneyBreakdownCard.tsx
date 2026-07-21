import Link from "next/link";

import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BreakdownRow = {
  key: string;
  label: string;
  value: number;
  color: string;
};

/**
 * Shared shape for the dashboard's "hero total + proportion bar + per-account
 * rows" cards (money on hand, sales by channel, …). A proportion bar is only
 * meaningful over non-negative amounts, so it hides itself if any row has
 * gone negative (an oversold/odd state) — the rows still show the true
 * (signed) figures underneath.
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
  /** If set, the whole card becomes a link. */
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  const barTotal = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const showBar = barTotal > 0 && rows.every((row) => row.value >= 0);

  const content = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        {href ? (
          <p className="text-xs text-muted-foreground">{linkLabel}</p>
        ) : null}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {formatPeso(total)}
      </p>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}

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
          <p
            key={row.key}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
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
        ))}
      </div>
    </>
  );

  const classes = cn(
    "rounded-lg border bg-card p-4",
    href && "block transition-colors hover:bg-muted/30",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return <div className={classes}>{content}</div>;
}
