"use client";

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
import type { Product } from "@/lib/types";
import CheckoutForm from "./checkout/checkoutForm";

/**
 * "New sale" opens as a bottom sheet instead of navigating away, so the
 * cashier never loses the dashboard. Two triggers, one drawer:
 * header button from `sm` up, floating bottom-centre pill on phones.
 *
 * The drawer unmounts its contents on close, so quantities and search reset
 * for the next sale without any bookkeeping here.
 */
export default function NewSaleDrawer({
  products,
  topProductIds,
}: {
  products: Product[];
  /** Product ids ranked by units sold, best first. */
  topProductIds?: string[];
}) {
  return (
    <Drawer showSwipeHandle>
      {/* Header placement — tablet and up */}
      <DrawerTrigger className={cn(buttonVariants(), "hidden sm:inline-flex")}>
        New sale
      </DrawerTrigger>

      {/* Floating action button — phones only */}
      <DrawerTrigger
        className={cn(
          buttonVariants(),
          "fixed inset-x-0 z-50 mx-auto w-fit sm:hidden",
          // env() resolves to 0 without viewport-fit=cover, so this falls back
          // to 1.5rem and still clears the home indicator on notched phones.
          "bottom-[calc(1.5rem+env(safe-area-inset-bottom))]",
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
      <DrawerContent className="h-[75dvh]">
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
            doneSlot={
              <DrawerClose
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
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
