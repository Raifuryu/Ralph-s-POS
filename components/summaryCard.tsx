import { cn } from "@/lib/utils";

/** Dashboard stat card, with optional small secondary rows (e.g. wallets). */
export function SummaryCard({
  label,
  value,
  breakdown,
  compact = false,
  className,
}: {
  label: string;
  value: string;
  breakdown?: { label: string; value: string }[];
  /** Tighter type scale for narrow tiles (thirds of a phone screen). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", compact && "p-3", className)}>
      <p
        className={cn(
          "text-sm text-muted-foreground",
          compact && "truncate text-xs"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-semibold tabular-nums",
          compact ? "text-lg" : "text-2xl"
        )}
      >
        {value}
      </p>
      {breakdown?.length ? (
        <div className="mt-2 flex flex-col gap-0.5 border-t pt-2">
          {breakdown.map((row) => (
            <p
              key={row.label}
              className="flex items-baseline justify-between text-xs text-muted-foreground"
            >
              <span>{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
