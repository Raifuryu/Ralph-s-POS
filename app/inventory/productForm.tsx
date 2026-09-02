"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Category, Product } from "@/lib/types";
import { updateProduct, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

export default function ProductForm({
  product,
  categories,
}: {
  product: Product;
  categories: Category[];
}) {
  const [state, formAction, isPending] = useActionState(
    updateProduct,
    initialState
  );

  const [price, setPrice] = useState(String(product.price));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={product.id} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="name" className="text-xs">
          Name
        </Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={product.name}
          placeholder="e.g. Sardinas"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="price" className="text-xs">
            Price
          </Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            required
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="cost" className="text-xs">
            Cost{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="cost"
            name="cost"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            defaultValue={product.cost ?? ""}
            placeholder="10.00"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="stock" className="text-xs">
            Qty{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          {/* No min: oversold items carry a negative count until recounted,
              and the row must remain saveable as-is. */}
          <Input
            id="stock"
            name="stock"
            type="number"
            step="1"
            inputMode="numeric"
            defaultValue={product.stock ?? ""}
            placeholder="Blank"
          />
        </div>
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        Cost is what you currently pay per item — drives the profit shown on
        sales. Restocking through Inventory → Restock updates this
        automatically; edit it here to correct it directly.
      </p>

      <p className="-mt-2 text-xs text-muted-foreground">
        Leave quantity blank for items you don&apos;t count — tingi, sold by
        scoop, services. Blank means stock is never checked or reduced. Entering{" "}
        <span className="font-medium">0</span> means the opposite: counted, and
        currently out of stock.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="low_stock_threshold" className="text-xs">
            Low stock alert{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="low_stock_threshold"
            name="low_stock_threshold"
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            defaultValue={product.low_stock_threshold ?? ""}
            placeholder="5"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="expiry_date" className="text-xs">
            Expiry date{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="expiry_date"
            name="expiry_date"
            type="date"
            defaultValue={product.expiry_date ?? ""}
          />
        </div>
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        Low stock flags this item in the inventory list once its tracked
        count drops to this number or below (no effect on untracked items).
        Expiry date flags it as it approaches or passes that date. Leave
        either blank to skip that flag.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="category_id" className="text-xs">
            Category{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          {/* Native select on purpose: phones open their built-in picker,
              which beats any custom dropdown for one-handed use at the
              counter. */}
          <Select
            id="category_id"
            name="category_id"
            defaultValue={product.category_id ?? ""}
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="description" className="text-xs">
            Description{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="description"
            name="description"
            defaultValue={product.description ?? ""}
            placeholder="e.g. Sold by scoop"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
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
