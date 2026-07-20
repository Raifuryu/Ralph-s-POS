/** Dashboard stat card, with optional small secondary rows (e.g. wallets). */
export function SummaryCard({
  label,
  value,
  breakdown,
}: {
  label: string;
  value: string;
  breakdown?: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
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
