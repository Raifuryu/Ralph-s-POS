import type { LucideIcon } from "lucide-react";

/**
 * The one "nothing here yet" treatment, used everywhere a list/table can be
 * empty — matches the populated-card recipe (rounded-lg border bg-card)
 * rather than a separate borderless/differently-padded variant per screen.
 */
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-card py-10 text-center">
      {Icon ? <Icon className="mb-2 size-6 text-muted-foreground" /> : null}
      <p className="text-sm text-muted-foreground">{title}</p>
      {subtitle ? (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
