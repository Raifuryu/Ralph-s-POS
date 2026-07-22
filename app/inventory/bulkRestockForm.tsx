"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPeso } from "@/lib/format";
import { sellingPriceFor, toNumber } from "@/lib/pricing";
import type { Product } from "@/lib/types";
import { bulkRestock, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

// Owners fill this out while walking around the mall picking up stock — a
// long, interruptible session (phone locks, the sheet gets closed by
// accident, the app backgrounds). The draft is saved to localStorage on
// every change and restored on reopen so none of that gets lost before
// they've actually submitted.
const STORAGE_KEY = "ralph-pos:bulk-restock-cart";

type CartLine = {
  key: string;
  /** null means this line creates a brand-new product. */
  productId: string | null;
  /** Snapshot of the picked product's name — only used to gracefully
      recover a restored draft line whose product no longer exists. */
  productName: string;
  newName: string;
  quantity: string;
  cost: string;
  price: string;
  /** Only meaningful for new-item lines (productId === null): once the user
      types into Price themselves, stop auto-filling it from the markup
      calculator. Existing-item lines never auto-fill regardless. */
  priceTouched: boolean;
};

function emptyLine(): CartLine {
  return {
    key: crypto.randomUUID(),
    productId: null,
    productName: "",
    newName: "",
    quantity: "",
    cost: "",
    price: "",
    priceTouched: false,
  };
}

function isValidCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    (v.productId === null || typeof v.productId === "string") &&
    typeof v.productName === "string" &&
    typeof v.newName === "string" &&
    typeof v.quantity === "string" &&
    typeof v.cost === "string" &&
    typeof v.price === "string" &&
    typeof v.priceTouched === "boolean"
  );
}

function hasAnyContent(line: CartLine): boolean {
  return (
    line.productId !== null ||
    line.newName !== "" ||
    line.quantity !== "" ||
    line.cost !== "" ||
    line.price !== ""
  );
}

type PickerOption = { value: string; label: string };

const NEW_ITEM_OPTION: PickerOption = { value: "__new__", label: "+ New item" };

function CartLineCard({
  line,
  products,
  otherSelectedIds,
  onChange,
  onRemove,
  removable,
}: {
  line: CartLine;
  products: Product[];
  /** Products already picked by other lines — hidden from this line's picker. */
  otherSelectedIds: Set<string>;
  onChange: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const pickerOptions = products.filter(
    (p) => p.id === line.productId || !otherSelectedIds.has(p.id)
  );
  const pickerItems: PickerOption[] = [
    NEW_ITEM_OPTION,
    ...pickerOptions.map((p) => ({ value: p.id, label: p.name })),
  ];
  const selectedOption =
    pickerItems.find((item) => item.value === (line.productId ?? "__new__")) ??
    NEW_ITEM_OPTION;

  const qty = toNumber(line.quantity);
  const cost = toNumber(line.cost);
  const costPerPiece = qty > 0 && cost > 0 ? cost / qty : null;
  const suggested = costPerPiece !== null ? sellingPriceFor(costPerPiece) : null;

  function handleProductChange(option: PickerOption | null) {
    if (!option || option.value === "__new__") {
      onChange({
        productId: null,
        productName: "",
        price: "",
        priceTouched: false,
      });
      return;
    }
    const product = products.find((p) => p.id === option.value);
    onChange({
      productId: option.value,
      productName: product?.name ?? "",
      price: product ? String(product.price) : "",
      priceTouched: false,
    });
  }

  // New-item lines only: fill Price from the markup calculator as qty/cost
  // are typed, until the user edits Price directly. Existing-item lines
  // never auto-fill — restocking shouldn't silently change a real price.
  function handleQuantityChange(value: string) {
    const patch: Partial<CartLine> = { quantity: value };
    if (line.productId === null && !line.priceTouched) {
      const c = toNumber(line.cost);
      const q = toNumber(value);
      if (c > 0 && q > 0) patch.price = String(sellingPriceFor(c / q));
    }
    onChange(patch);
  }

  function handleCostChange(value: string) {
    const patch: Partial<CartLine> = { cost: value };
    if (line.productId === null && !line.priceTouched) {
      const c = toNumber(value);
      const q = toNumber(line.quantity);
      if (c > 0 && q > 0) patch.price = String(sellingPriceFor(c / q));
    }
    onChange(patch);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor={`item-${line.key}`} className="text-xs">
            Item
          </Label>
          <Combobox
            items={pickerItems}
            value={selectedOption}
            onValueChange={handleProductChange}
            isItemEqualToValue={(a, b) => a.value === b.value}
          >
            <ComboboxInput
              id={`item-${line.key}`}
              placeholder="Search items…"
            />
            <ComboboxContent>
              <ComboboxEmpty>No items match.</ComboboxEmpty>
              <ComboboxList>
                {(item: PickerOption) => (
                  <ComboboxItem key={item.value} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove this item from the cart"
            className="mt-6"
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>

      {line.productId === null ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`name-${line.key}`} className="text-xs">
            New item name
          </Label>
          <Input
            id={`name-${line.key}`}
            required
            placeholder="e.g. Sardinas"
            value={line.newName}
            onChange={(event) => onChange({ newName: event.target.value })}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`qty-${line.key}`} className="text-xs">
            Qty bought
          </Label>
          <Input
            id={`qty-${line.key}`}
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            required
            placeholder="6"
            value={line.quantity}
            onChange={(event) => handleQuantityChange(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`cost-${line.key}`} className="text-xs">
            Price bought
          </Label>
          <Input
            id={`cost-${line.key}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            required
            placeholder="60.00"
            value={line.cost}
            onChange={(event) => handleCostChange(event.target.value)}
          />
        </div>
      </div>

      {costPerPiece !== null && suggested !== null ? (
        <p className="text-xs">
          <span className="font-medium">
            {formatPeso(costPerPiece)} cost per piece
          </span>
          <span className="text-muted-foreground"> · suggested </span>
          <span className="font-medium">{formatPeso(suggested)}</span>
          <span className="text-muted-foreground"> at 30% markup</span>
          {line.productId === null && !line.priceTouched ? (
            <span className="text-muted-foreground">
              {" "}
              — filled in below, adjust if you like.
            </span>
          ) : (
            <>
              <span className="text-muted-foreground"> — </span>
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => onChange({ price: String(suggested) })}
              >
                use this
              </button>
            </>
          )}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`price-${line.key}`} className="text-xs">
          Selling price
        </Label>
        <Input
          id={`price-${line.key}`}
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          required
          placeholder="0.00"
          value={line.price}
          onChange={(event) =>
            onChange({ price: event.target.value, priceTouched: true })
          }
        />
      </div>
    </div>
  );
}

export default function BulkRestockForm({ products }: { products: Product[] }) {
  const [state, formAction, isPending] = useActionState(
    bulkRestock,
    initialState
  );
  // Fixed key for the initial line (not crypto.randomUUID()) — this runs
  // during SSR too, and a random key here would mismatch on hydration since
  // it's rendered into id/htmlFor attributes. Lines added later via "Add
  // another item" only ever happen from a client-side click, so those are
  // safe to key randomly.
  const [lines, setLines] = useState<CartLine[]>([
    {
      key: "initial",
      productId: null,
      productName: "",
      newName: "",
      quantity: "",
      cost: "",
      price: "",
      priceTouched: false,
    },
  ]);
  // Gates the persist effect below so it never fires before the restore
  // effect has had a chance to run — otherwise the freshly-mounted default
  // (one blank line) would overwrite a real saved draft on the very first
  // render, before React even gets a chance to restore it.
  const [hydrated, setHydrated] = useState(false);
  const [justRestored, setJustRestored] = useState(false);

  // Restore a saved draft on mount. localStorage isn't available during SSR,
  // so this only ever runs client-side, after hydration — a normal post-
  // mount state update, not a hydration-time mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidCartLine)) {
          // A line's product may have been deleted since the draft was
          // saved — fall back to a "new item" line using the last-known
          // name rather than silently pointing at nothing.
          const reconciled = parsed.map((line) =>
            line.productId && !products.some((p) => p.id === line.productId)
              ? {
                  ...line,
                  productId: null,
                  newName: line.newName || line.productName,
                }
              : line
          );
          if (reconciled.some(hasAnyContent)) {
            // Deliberately setState-in-effect: localStorage doesn't exist
            // during SSR, so the initial render (server AND the first
            // client render, which must match it for hydration) always
            // renders the plain default. Reading the real draft has to
            // happen after hydration completes, in an effect — reading it
            // any earlier (e.g. a lazy useState initializer) would make the
            // first client render diverge from the server-rendered HTML.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLines(reconciled);
            setJustRestored(true);
          }
        }
      }
    } catch {
      // Corrupt or unavailable storage — just start fresh.
    }
    setHydrated(true);
  }, [products]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Storage full/unavailable — the draft just won't persist, not fatal.
    }
  }, [lines, hydrated]);

  function updateLine(key: string, patch: Partial<CartLine>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  function clearCart() {
    setLines([emptyLine()]);
    setJustRestored(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage isn't available.
    }
  }

  const hasContent = lines.some(hasAnyContent);

  const total = lines.reduce((sum, line) => sum + toNumber(line.cost), 0);
  const pieceCount = lines.reduce(
    (sum, line) => sum + toNumber(line.quantity),
    0
  );

  const hasIncompleteLine = lines.some((line) => {
    if (line.productId === null && !line.newName.trim()) return true;
    return !line.quantity || !line.cost || !line.price;
  });

  return (
    <form
      action={formAction}
      onSubmit={() => {
        // Only reachable via the submit button, which is disabled while any
        // line is incomplete — so a submit event here means the cart looked
        // good client-side. Clear the draft now rather than waiting for a
        // "success" signal from the server action: a successful submit
        // redirects server-side, which never delivers a resolved state back
        // to this component to hook a cleanup into. If the server ends up
        // rejecting it anyway (rare — e.g. an item got deleted moments
        // before submit), nothing on screen is lost, and the next edit
        // re-persists this same draft to storage.
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Nothing to clean up if storage isn't available.
        }
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <input
        type="hidden"
        name="cart"
        value={JSON.stringify(
          lines.map((line) => ({
            product_id: line.productId,
            name: line.productId ? null : line.newName.trim(),
            quantity: line.quantity,
            cost: line.cost,
            price: line.price,
          }))
        )}
      />

      {hasContent ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {justRestored
              ? "Picked up where you left off."
              : "Not saved until you submit."}
          </span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={clearCart}
          >
            Start over
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {lines.map((line) => (
          <CartLineCard
            key={line.key}
            line={line}
            products={products}
            otherSelectedIds={
              new Set(
                lines
                  .filter((l) => l.key !== line.key && l.productId !== null)
                  .map((l) => l.productId as string)
              )
            }
            onChange={(patch) => updateLine(line.key, patch)}
            onRemove={() => removeLine(line.key)}
            removable={lines.length > 1}
          />
        ))}

        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
        >
          <PlusIcon data-icon="inline-start" />
          Add another item
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-0 pt-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Total
            {pieceCount > 0
              ? ` · ${pieceCount} pc${pieceCount === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(total)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/inventory" />}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending || lines.length === 0 || hasIncompleteLine}
          >
            {isPending ? "Recording…" : "Record purchase"}
          </Button>
        </div>
      </DrawerFooter>
    </form>
  );
}
