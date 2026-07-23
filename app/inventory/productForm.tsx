"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatPeso } from "@/lib/format";
import { sellingPriceFor, toNumber } from "@/lib/pricing";
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

  // Restock & pricing helper. Only restock_qty and restock_cost are
  // submitted — cost per piece and the suggested selling price (cost + 30%)
  // are shown as a hint only; editing an existing item never auto-fills
  // Price, since there's already a real price that shouldn't get silently
  // overwritten while just logging a restock.
  const [batchCost, setBatchCost] = useState("");
  const [restockQty, setRestockQty] = useState("");

  const cost = toNumber(batchCost);
  const qty = toNumber(restockQty);

  const costPerPiece = cost > 0 && qty > 0 ? cost / qty : null;
  const sellingPrice =
    costPerPiece !== null ? sellingPriceFor(costPerPiece) : null;
  const currentStock = product.stock;

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

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">Restock &amp; pricing</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="batch_cost" className="text-xs">
              Price bought
            </Label>
            <Input
              id="batch_cost"
              name="restock_cost"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              required={qty > 0}
              placeholder="60.00"
              value={batchCost}
              onChange={(event) => setBatchCost(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="restock_qty" className="text-xs">
              Qty bought
            </Label>
            <Input
              id="restock_qty"
              name="restock_qty"
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              placeholder="6"
              value={restockQty}
              onChange={(event) => setRestockQty(event.target.value)}
            />
          </div>
        </div>

        {costPerPiece !== null && sellingPrice !== null ? (
          <p className="text-xs" data-testid="pricing-line">
            <span className="font-medium">
              {formatPeso(costPerPiece)} cost per piece
            </span>
            <span className="text-muted-foreground"> · sells for </span>
            <span className="font-medium">{formatPeso(sellingPrice)}</span>
            <span className="text-muted-foreground">
              {" "}
              at 30% markup — set the price above yourself.
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            e.g. bought 6 pcs for ₱60 → costs ₱10 each → sells for ₱13 at 30%
            markup.
          </p>
        )}

        {qty > 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="restock-line"
          >
            Saving adds {qty} pc{qty === 1 ? "" : "s"} to stock
            {currentStock !== null
              ? ` (${currentStock} → ${currentStock + qty})`
              : " (starts counting this item)"}
            .
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="stock" className="text-xs">
            Quantity{" "}
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
            placeholder="Leave blank"
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
        <Label htmlFor="category_id" className="text-xs">
          Category{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        {/* Native select on purpose: phones open their built-in picker, which
            beats any custom dropdown for one-handed use at the counter. */}
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="description" className="text-xs">
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="description"
          name="description"
          defaultValue={product.description ?? ""}
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
