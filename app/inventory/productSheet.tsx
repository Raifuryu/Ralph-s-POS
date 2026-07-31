"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { Category, Product } from "@/lib/types";
import ProductForm from "./productForm";

/**
 * The edit-item form as a bottom sheet. Open state is URL-driven
 * (?edit=<id>), so links open it, deep links work, and the server action's
 * redirect to /inventory closes it after a successful save.
 */
export default function ProductSheet({
  open,
  product,
  categories,
}: {
  open: boolean;
  product?: Product;
  categories: Category[];
}) {
  const router = useRouter();

  // Local, not driven purely by the `open` prop — a swipe-to-close needs to
  // animate away instantly. If it waited on `open` to flip (it's URL-driven,
  // via the router.push below), the sheet would sit open until that
  // navigation's server round trip finished, which feels laggy next to
  // every other Drawer in the app that closes off local state alone.
  // Reset-during-render (React's "adjust state during render" pattern):
  // only re-syncs from the prop when it actually changes (a fresh deep
  // link, or the save action's redirect), never stomping an in-progress
  // swipe.
  const [openState, setOpenState] = useState({ prop: open, value: open });
  if (openState.prop !== open) {
    setOpenState({ prop: open, value: open });
  }
  const drawerOpen = openState.value;

  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(next) => {
        setOpenState({ prop: open, value: next });
        if (!next) router.push("/inventory", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>{product ? `Edit ${product.name}` : "Edit item"}</DrawerTitle>
          <DrawerDescription>
            Price changes never affect sales already recorded.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {product ? (
            <ProductForm key={product.id} product={product} categories={categories} />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
