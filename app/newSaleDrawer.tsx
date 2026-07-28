"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { MoneyAccount, Product, Service } from "@/lib/types";
import CheckoutForm from "./checkout/checkoutForm";

/**
 * "New sale" opens as a bottom sheet instead of navigating away, so the
 * cashier never loses the dashboard. Two triggers, one drawer:
 * header button from `sm` up, floating bottom-centre pill on phones.
 * Covers both products and e-services in one cart — see CheckoutForm and
 * migration 0031's record_visit(), which records the whole thing (either
 * kind, or both together) in one atomic transaction.
 *
 * The drawer unmounts its contents on close, so quantities and search reset
 * for the next sale without any bookkeeping here. Controlled (not just
 * Trigger/Close-driven) so a successful sale can close it automatically
 * instead of waiting on the Done button.
 */
export default function NewSaleDrawer({
  products,
  topProductIds,
  services,
  balances,
}: {
  products: Product[];
  /** Product ids ranked by units sold, best first. */
  topProductIds?: string[];
  services: Service[];
  balances: Map<MoneyAccount, number>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      {/* Header placement — tablet and up */}
      <DrawerTrigger className={cn(buttonVariants(), "hidden sm:inline-flex")}>
        New sale
      </DrawerTrigger>

      {/* Floating pill on phones, centred now that it's the only one. */}
      <DrawerTrigger
        className={cn(
          buttonVariants(),
          "fixed left-1/2 z-50 -translate-x-1/2 sm:hidden",
          // Sits above AppNav's bottom tab bar (--bottom-nav-h), plus the
          // safe-area inset for notched phones.
          "bottom-[calc(1.5rem+env(safe-area-inset-bottom)+var(--bottom-nav-h))]",
          // h-12 = 48px: a real thumb target. The `lg` size is only 36px.
          "h-12 rounded-full px-6 text-base shadow-lg"
        )}
      >
        <PlusIcon data-icon="inline-start" />
        New sale
      </DrawerTrigger>

      {/* Fixed 75% height: a content-sized sheet jumps around as the
          catalogue grows/filters; a stable height keeps the footer and
          Record button in the same place for muscle memory. */}
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>New sale</DrawerTitle>
          <DrawerDescription>
            Prices are locked in at the moment of sale.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <CheckoutForm
            products={products}
            topProductIds={topProductIds}
            services={services}
            balances={balances}
            onRecorded={() => setOpen(false)}
            doneSlot={
              <DrawerClose
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Done
              </DrawerClose>
            }
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
