import { cn } from "@/lib/utils";

/**
 * The standard page frame: centred column with responsive padding. Every
 * authenticated page uses this so spacing changes happen in one place.
 */
export function PageShell({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  /** Extra classes on <main> (e.g. pb-28 to clear the floating buttons). */
  className?: string;
  /** Extra classes on the inner column (e.g. a narrower max width). */
  innerClassName?: string;
}) {
  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col items-center p-4 sm:p-8 md:p-12",
        className
      )}
    >
      <div
        className={cn(
          "flex w-full min-w-0 max-w-3xl flex-col gap-6",
          innerClassName
        )}
      >
        {children}
      </div>
    </main>
  );
}

/** Full-page load-failure state with the raw error for debugging. */
export function PageError({
  title,
  message,
  hint,
}: {
  title: string;
  message: string;
  hint?: React.ReactNode;
}) {
  return (
    <PageShell>
      <div className="rounded-lg border border-destructive/50 p-4">
        <h1 className="font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        {hint ? (
          <p className="mt-3 text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </PageShell>
  );
}
