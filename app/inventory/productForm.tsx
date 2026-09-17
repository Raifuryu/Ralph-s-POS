"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import { roundMoney, sellingPriceFor, toNumber } from "@/lib/pricing";
import type { Category, Product } from "@/lib/types";
import { createProduct, updateProduct, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

export default function ProductForm({
  product,
  categories,
  onCancel,
}: {
  /** Omit (or null) to register a brand-new product instead of editing one
      — see createProduct's own doc comment for what that does (and
      deliberately doesn't do). */
  product?: Product | null;
  categories: Category[];
  /** Overrides the default Cancel behavior (navigating to /inventory) —
      BulkRestockSheet's own "New item" mode uses this to switch the toggle
      back to "Restock" instead of closing the whole sheet. Also the signal
      this form uses to switch its own chrome to match BulkRestockForm's
      (card-wrapped fields, a bottom DrawerFooter instead of a plain button
      row) — the owner wants the two tabs to read as one consistent design,
      not two different-looking forms glued together by a tab switch.
      ProductSheet (the only other caller) never passes this, so it's a
      reliable signal for "embedded in BulkRestockSheet" with no separate
      prop needed. Omit to keep the plain layout (ProductSheet's own
      edit-mode usage). */
  onCancel?: () => void;
}) {
  const isEdit = Boolean(product);
  const embedded = Boolean(onCancel);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateProduct : createProduct,
    initialState
  );

  const [price, setPrice] = useState(String(product?.price ?? ""));
  // Controlled alongside `price` so the embedded layout can show the same
  // live "₱X/pc · suggested ₱Y" hint and footer margin CartLineCard does.
  const [cost, setCost] = useState(String(product?.cost ?? ""));
  // Controlled too, since "Pack" mode below needs it to divide a pack total
  // down to the per-piece cost products.cost actually stores.
  const [stock, setStock] = useState(String(product?.stock ?? ""));
  /** Same two modes CartLineCard offers. "individual" is the default here
      (CartLineCard defaults to "pack") because Cost is optional on this tab
      and Qty can be left blank — pack mode has nothing to divide by then —
      and because it keeps the field meaning exactly what it always was for
      anyone who ignores this toggle. */
  const [costMode, setCostMode] = useState<"pack" | "individual">("individual");

  const priceNum = toNumber(price);
  const costNum = toNumber(cost);
  const qtyNum = toNumber(stock);
  // products.cost is a PER-PIECE figure everywhere in the app (recordRestock
  // divides a batch cost by its quantity before writing it), so a pack total
  // typed here has to be divided the same way before it's submitted — see
  // the hidden `cost` input below, which carries this instead of the raw
  // typed value.
  const costPerPiece =
    costMode === "individual"
      ? costNum > 0
        ? costNum
        : null
      : costNum > 0 && qtyNum > 0
        ? roundMoney(costNum / qtyNum)
        : null;
  // Pack mode can't work out a per-piece cost without a quantity, and Qty is
  // optional here — flag that rather than silently dropping what was typed.
  const packNeedsQty = costMode === "pack" && costNum > 0 && qtyNum <= 0;
  const suggested = costPerPiece !== null ? sellingPriceFor(costPerPiece) : null;
  const margin =
    priceNum > 0 && costPerPiece !== null
      ? roundMoney(priceNum - costPerPiece)
      : null;

  // Cleared rather than converted when the mode flips, same reasoning
  // CartLineCard's own handleCostModeChange gives: a stale pack total
  // silently reappearing as a per-item figure (or vice versa) is worse than
  // retyping it.
  function handleCostModeChange(next: "pack" | "individual") {
    setCostMode(next);
    setCost("");
  }

  const fields = (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="name" className="text-xs">
          {embedded ? "New item name" : "Name"}
        </Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={product?.name}
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
            value={cost}
            onChange={(event) => setCost(event.target.value)}
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
            defaultValue={product?.stock ?? ""}
            placeholder="Blank"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Cost is what you currently pay per item — drives the profit shown on
        sales. Restocking through Inventory → Restock updates this
        automatically; edit it here to correct it directly.
      </p>

      <p className="text-xs text-muted-foreground">
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
            defaultValue={product?.low_stock_threshold ?? ""}
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
            defaultValue={product?.expiry_date ?? ""}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
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
            defaultValue={product?.description ?? ""}
            placeholder="e.g. Sold by scoop"
          />
        </div>
      </div>
    </>
  );

  if (embedded) {
    // Deliberately its own layout rather than the standalone one above in a
    // card: the owner wants this tab and Restock to read as the same screen,
    // so it mirrors CartLineCard field-for-field — same card, same gap-2
    // rhythm, same "New item name" → Category/Description → Qty/Cost/Price
    // order, same one-line suggested-price hint — and BulkRestockForm's own
    // footer (a headline figure on the left, Cancel + primary on the right,
    // both default-size). The long explanatory paragraphs the standalone
    // editor carries are collapsed into the single hint line below, since
    // Restock's own card has no room for that kind of prose either.
    return (
      <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4">
        {product ? <input type="hidden" name="id" value={product.id} /> : null}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-2.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="name" className="text-xs">
                New item name
              </Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={product?.name}
                placeholder="e.g. Sardinas"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="category_id" className="text-xs">
                  Category
                </Label>
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="description" className="text-xs">
                  Description
                </Label>
                <Input
                  id="description"
                  name="description"
                  defaultValue={product?.description ?? ""}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Bought as</Label>
              <Tabs
                value={costMode}
                onValueChange={(value) =>
                  handleCostModeChange(value as "pack" | "individual")
                }
                className="w-full min-w-0"
              >
                <TabsList className="w-full sm:w-fit">
                  <TabsTrigger value="pack">Pack</TabsTrigger>
                  <TabsTrigger value="individual">Individually</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* The per-piece figure products.cost actually stores — derived
                from the pack total in pack mode, passed straight through in
                individual mode. toFixed(2) because parseMoney rejects more
                than two decimals outright, and a division rarely lands on
                exactly two (see createProduct's own parseForm). */}
            <input
              type="hidden"
              name="cost"
              value={costPerPiece !== null ? costPerPiece.toFixed(2) : ""}
            />

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="stock" className="text-xs">
                  Qty
                </Label>
                {/* No min: oversold items carry a negative count until
                    recounted, and the row must remain saveable as-is. */}
                <Input
                  id="stock"
                  name="stock"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={stock}
                  onChange={(event) => setStock(event.target.value)}
                  placeholder="Blank"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cost-input" className="text-xs">
                  {costMode === "individual" ? "Cost/item" : "Cost"}
                </Label>
                <Input
                  id="cost-input"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder={costMode === "individual" ? "15.00" : "60.00"}
                />
              </div>
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
            </div>

            {packNeedsQty ? (
              <p className="text-xs text-warning">
                Enter a Qty so the pack cost can be split per item — without
                one, the cost won&apos;t be saved.
              </p>
            ) : null}

            {suggested !== null && costPerPiece !== null ? (
              <p className="text-xs">
                <span className="font-medium">{formatPeso(costPerPiece)}/pc</span>
                <span className="text-muted-foreground"> · suggested </span>
                <span className="font-medium">{formatPeso(suggested)}</span>
                {price === String(suggested) ? null : (
                  <>
                    <span className="text-muted-foreground"> — </span>
                    <button
                      type="button"
                      className="font-medium text-primary underline underline-offset-2"
                      onClick={() => setPrice(String(suggested))}
                    >
                      use this
                    </button>
                  </>
                )}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="low_stock_threshold" className="text-xs">
                  Low stock alert
                </Label>
                <Input
                  id="low_stock_threshold"
                  name="low_stock_threshold"
                  type="number"
                  step="1"
                  min="0"
                  inputMode="numeric"
                  defaultValue={product?.low_stock_threshold ?? ""}
                  placeholder="Optional"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="expiry_date" className="text-xs">
                  Expiry date
                </Label>
                <Input
                  id="expiry_date"
                  name="expiry_date"
                  type="date"
                  defaultValue={product?.expiry_date ?? ""}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Nothing is bought here — Qty and Cost are optional, and no
              payment is recorded. Leave Qty blank for items you don&apos;t
              count (tingi, by scoop); restocking through Restock fills Cost
              in for you later.
            </p>
          </div>
        </div>

        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-0 pt-4">
          <div>
            <p className="text-sm text-muted-foreground">Price</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatPeso(priceNum)}
            </p>
            {margin !== null && costPerPiece !== null ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatPeso(costPerPiece)}/pc cost · {margin >= 0 ? "+" : "-"}
                {formatPeso(Math.abs(margin))}/pc
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Add item"}
            </Button>
          </div>
        </DrawerFooter>
      </form>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      {fields}

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
