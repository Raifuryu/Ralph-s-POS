import { cn } from "@/lib/utils";

/** Toggle-pill filter control — a row of these (one active at a time within
    a row) is how every non-category filter in the app works (Inventory's
    stock/expiry/cost, Sales' void/personal-take). */
export function FilterChip({
  label,
  active,
  tone = "neutral",
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "neutral" | "warning" | "destructive";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        tone === "neutral" &&
          (active
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-transparent text-muted-foreground hover:bg-muted/50"),
        tone === "warning" &&
          (active
            ? "border-warning bg-warning text-white"
            : "border-warning/40 text-warning hover:bg-warning/10"),
        tone === "destructive" &&
          (active
            ? "border-destructive bg-destructive text-white"
            : "border-destructive/40 text-destructive hover:bg-destructive/10")
      )}
    >
      {label}
    </button>
  );
}
