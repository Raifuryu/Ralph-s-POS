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
