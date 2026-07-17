"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Product } from "@/lib/types";
import { createProduct, updateProduct, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

export default function ProductForm({
  product,
}: {
  /** Omit to create a new product. */
  product?: Product;
}) {
  const isEdit = Boolean(product);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateProduct : createProduct,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={product?.name ?? ""}
          placeholder="e.g. Sardinas"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="price">Price</Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            required
            inputMode="decimal"
            defaultValue={product?.price ?? ""}
            placeholder="0.00"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="stock">
            Quantity{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="stock"
            name="stock"
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            defaultValue={product?.stock ?? ""}
            placeholder="Blank if not counted"
          />
        </div>
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        Leave quantity blank for items you don&apos;t count — tingi, sold by
        scoop, services. Blank means stock is never checked or reduced. Entering{" "}
        <span className="font-medium">0</span> means the opposite: counted, and
        currently out of stock.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="description"
          name="description"
          defaultValue={product?.description ?? ""}
          placeholder="e.g. Sold by scoop from an open sack"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Add item"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/inventory" />}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
