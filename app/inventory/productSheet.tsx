"use client";

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
 * The add/edit item form as a bottom sheet. Open state is URL-driven
 * (?new / ?edit=<id>), so links open it, deep links work, and the server
 * action's redirect to /inventory closes it after a successful save.
 */
export default function ProductSheet({
  open,
  product,
  categories,
}: {
  open: boolean;
  /** Present when editing; omitted for a new item. */
  product?: Product;
  categories: Category[];
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
          <DrawerTitle>
            {product ? `Edit ${product.name}` : "New item"}
          </DrawerTitle>
          <DrawerDescription>
            {product
              ? "Price changes never affect sales already recorded."
              : "Blank quantity means the item isn't counted."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {/* key resets the form when switching between items */}
          <ProductForm
            key={product?.id ?? "new"}
            product={product}
            categories={categories}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
