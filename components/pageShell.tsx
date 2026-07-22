import { AppNav } from "@/components/appNav";
import { cn } from "@/lib/utils";

/**
 * The standard page frame: centred column with responsive padding. Every
 * authenticated page uses this so spacing changes happen in one place. Also
 * renders AppNav (bottom tab bar on mobile, top bar on desktop) — every
 * PageShell-using page gets the shared nav automatically; app/login/page.tsx
 * doesn't use PageShell, so it's excluded with no extra conditionals.
 *
 * Top/bottom padding reserves space for AppNav's bar on each breakpoint
 * (mobile: bottom tab bar; desktop: top bar) on top of the normal padding.
 */
export function PageShell({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  /** Extra classes on <main> (e.g. more bottom padding to clear a page's own floating buttons). */
  className?: string;
  /** Extra classes on the inner column (e.g. a narrower max width). */
  innerClassName?: string;
}) {
  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col items-center p-4 pb-[calc(var(--bottom-nav-h)+1rem)] sm:p-8 sm:pt-[calc(var(--bottom-nav-h)+2rem)] md:p-12 md:pt-[calc(var(--bottom-nav-h)+3rem)]",
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
      <AppNav />
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
