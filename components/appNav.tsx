"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PackageIcon, ReceiptIcon, WalletIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DESTINATIONS = [
  { href: "/", label: "Sales", icon: ReceiptIcon },
  { href: "/inventory", label: "Inventory", icon: PackageIcon },
  { href: "/vault", label: "Vault", icon: WalletIcon },
] as const;

/**
 * Persistent app-wide navigation: a fixed bottom tab bar on mobile, a fixed
 * top bar on desktop — both showing the same three destinations everywhere,
 * replacing the old per-page hub-and-spoke (dashboard linked out to
 * Vault/Inventory, but Vault and Inventory only linked back to Sales, never
 * to each other). Hidden entirely on /checkout, which stays distraction-free
 * during an active sale.
 */
export function AppNav() {
  const pathname = usePathname();
  if (pathname === "/checkout") return null;

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 top-0 z-40 hidden h-[var(--bottom-nav-h)] items-center justify-center gap-2 border-b bg-background sm:flex"
      >
        {DESTINATIONS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Button
              key={href}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              nativeButton={false}
              render={<Link href={href} />}
            >
              {label}
            </Button>
          );
        })}
      </nav>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] border-t bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {DESTINATIONS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
