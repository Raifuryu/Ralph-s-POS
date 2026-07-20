"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatPeso } from "@/lib/format";
import type { Category, Product } from "@/lib/types";
import { createProduct, updateProduct, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Per-piece price rounded UP to the centavo, so selling the whole batch
    always reaches the target (rounding down lands a few centavos short). */
function pricePerPiece(target: number, qty: number): number {
  return Math.ceil((target / qty) * 100) / 100;
}

export default function ProductForm({
  product,
  categories,
}: {
  /** Omit to create a new product. */
  product?: Product;
  categories: Category[];
}) {
  const isEdit = Boolean(product);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateProduct : createProduct,
    initialState
  );

  // Controlled so the pricing helper can fill it; stays hand-editable.
  const [price, setPrice] = useState(
    product?.price !== undefined ? String(product.price) : ""
  );

  // Restock & pricing helper. Only restock_qty is submitted — the other two
  // exist to compute the per-piece price and show the batch profit.
  const [batchCost, setBatchCost] = useState("");
  const [restockQty, setRestockQty] = useState("");
  const [targetTotal, setTargetTotal] = useState("");

  const cost = toNumber(batchCost);
  const qty = toNumber(restockQty);
  const target = toNumber(targetTotal);

  const perPiece = qty > 0 && target > 0 ? pricePerPiece(target, qty) : null;
  const batchProfit = cost > 0 && target > 0 ? target - cost : null;
  const currentStock = product?.stock ?? null;

  function applyHelper(nextQty: string, nextTarget: string) {
    const q = toNumber(nextQty);
    const t = toNumber(nextTarget);
    if (q > 0 && t > 0) setPrice(String(pricePerPiece(t, q)));
  }

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
            value={price}
            onChange={(event) => setPrice(event.target.value)}
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
          {/* No min: oversold items carry a negative count until recounted,
              and the row must remain saveable as-is. */}
          <Input
            id="stock"
            name="stock"
            type="number"
            step="1"
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

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">Restock &amp; pricing</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="batch_cost" className="text-xs">
              Price bought
            </Label>
            <Input
              id="batch_cost"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
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
              onChange={(event) => {
                setRestockQty(event.target.value);
                applyHelper(event.target.value, targetTotal);
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="target_total" className="text-xs">
              Sell all for
            </Label>
            <Input
              id="target_total"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="80.00"
              value={targetTotal}
              onChange={(event) => {
                setTargetTotal(event.target.value);
                applyHelper(restockQty, event.target.value);
              }}
            />
          </div>
        </div>

        {perPiece !== null ? (
          <p className="text-xs" data-testid="pricing-line">
            <span className="font-medium">
              {formatPeso(perPiece)} per piece
            </span>
            {batchProfit !== null ? (
              batchProfit >= 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  · earns {formatPeso(batchProfit)} on this batch
                </span>
              ) : (
                <span className="font-medium text-destructive">
                  {" "}
                  · below what you paid by {formatPeso(-batchProfit)}
                </span>
              )
            ) : null}
            <span className="text-muted-foreground">
              {" "}
              — price filled in above.
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            e.g. bought 6 pcs for ₱60, want ₱20 profit → sell all for ₱80 →
            price becomes ₱13.34 each.
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="category_id">
          Category{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        {/* Native select on purpose: phones open their built-in picker, which
            beats any custom dropdown for one-handed use at the counter. */}
        <Select
          id="category_id"
          name="category_id"
          defaultValue={product?.category_id ?? ""}
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
