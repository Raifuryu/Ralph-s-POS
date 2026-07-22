"use client";

import { useRouter } from "next/navigation";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { Product } from "@/lib/types";
import BulkRestockForm from "./bulkRestockForm";

/**
 * Log a whole supplier receipt at once — a draft cart, URL-driven (?bulk)
 * like ProductSheet, nothing saved until submitted.
 */
export default function BulkRestockSheet({
  open,
  products,
}: {
  open: boolean;
  products: Product[];
}) {
  const router = useRouter();

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) router.push("/inventory", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Bulk restock</DrawerTitle>
          <DrawerDescription>
            Add each item bought, its cost, and its selling price. Nothing is
            saved until you submit.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <BulkRestockForm products={products} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
