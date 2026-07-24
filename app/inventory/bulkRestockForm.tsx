"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";

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
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import { costFor, costPerPieceFor, sellingPriceFor, toNumber } from "@/lib/pricing";
import type { Category, Product } from "@/lib/types";
import { bulkRestock, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

// Owners fill this out while walking around the mall picking up stock — a
// long, interruptible session (phone locks, the sheet gets closed by
// accident, the app backgrounds). The draft is saved to localStorage on
// every change and restored on reopen so none of that gets lost before
// they've actually submitted.
const STORAGE_KEY = "ralph-pos:bulk-restock-cart";

/** "pack" — Cost is the total for the whole batch, matching how a sealed
    case/pack is usually bought. "individual" — Cost per item is entered
    directly instead, for loose pieces bought one at a time with no pack
    total to divide; the total is derived (Cost per item x Qty) rather than
    typed. */
type CostMode = "pack" | "individual";

type CartLine = {
  key: string;
  /** null means this line creates a brand-new product. */
  productId: string | null;
  /** Snapshot of the picked product's name — only used to gracefully
      recover a restored draft line whose product no longer exists. */
  productName: string;
  newName: string;
  quantity: string;
  costMode: CostMode;
  /** Total batch cost — used when costMode is "pack". */
  cost: string;
  /** Cost per single piece — used when costMode is "individual". */
  costPerItem: string;
  price: string;
  /** Only meaningful for new-item lines (productId === null): whichever of
      Cost/Price the user has typed into directly is a "driver" the
      calculator won't overwrite; the other one (if untouched) is free to be
      auto-filled from Qty + the touched field. If both get touched, neither
      is auto-filled anymore. Existing-item lines never auto-fill regardless. */
  priceTouched: boolean;
  costTouched: boolean;
  /** Only meaningful for new-item lines. */
  categoryId: string;
  description: string;
};

function emptyLine(): CartLine {
  return {
    key: crypto.randomUUID(),
    productId: null,
    productName: "",
    newName: "",
    quantity: "",
    costMode: "pack",
    cost: "",
    costPerItem: "",
    price: "",
    priceTouched: false,
    costTouched: false,
    categoryId: "",
    description: "",
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
    typeof v.priceTouched === "boolean" &&
    typeof v.costTouched === "boolean" &&
    typeof v.categoryId === "string" &&
    typeof v.description === "string"
  );
}

function hasAnyContent(line: CartLine): boolean {
  return (
    line.productId !== null ||
    line.newName !== "" ||
    line.quantity !== "" ||
    line.cost !== "" ||
    line.costPerItem !== "" ||
    line.price !== ""
  );
}

/** A line is ready to submit — also doubles as "safe to auto-collapse",
    since there's nothing left to fill in. */
function isLineComplete(line: CartLine): boolean {
  if (line.productId === null && !line.newName.trim()) return false;
  if (!line.price) return false;
  const costValue = line.costMode === "individual" ? line.costPerItem : line.cost;
  if (line.productId !== null) {
    return Boolean(line.quantity) && Boolean(costValue);
  }
  const hasQty = line.quantity.trim() !== "";
  const hasCost = costValue.trim() !== "";
  return hasQty === hasCost;
}

/** Effective total cost for a line regardless of costMode — informational
    only (cart total, collapsed-card summary), so "0" for an incomplete line
    is fine here, same as toNumber's existing blank/invalid convention. */
function totalCostFor(line: CartLine): number {
  if (line.costMode === "individual") {
    return Math.round(toNumber(line.costPerItem) * toNumber(line.quantity) * 100) / 100;
  }
  return toNumber(line.cost);
}

/** Total-cost STRING for the submitted cart payload — "" when either input
    needed to compute it (in the active cost mode) hasn't been filled in yet.
    Unlike totalCostFor, blank must stay blank here: the server reads a blank
    quantity + blank cost together as "register this item without stocking
    it yet," and a stray "0" would break that. */
function costPayloadFor(line: CartLine): string {
  if (line.costMode === "individual") {
    if (line.quantity.trim() === "" || line.costPerItem.trim() === "") return "";
    return String(totalCostFor(line));
  }
  return line.cost;
}

type PickerOption = { value: string; label: string };

const NEW_ITEM_OPTION: PickerOption = { value: "__new__", label: "+ New item" };

function CartLineCard({
  line,
  products,
  categories,
  otherSelectedIds,
  onChange,
  onRemove,
  removable,
  collapsed,
  onToggleCollapse,
}: {
  line: CartLine;
  products: Product[];
  categories: Category[];
  /** Products already picked by other lines — hidden from this line's picker. */
  otherSelectedIds: Set<string>;
  onChange: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
  removable: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
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
  // Pack mode: Cost is the batch total, so cost-per-piece is derived by
  // dividing by Qty. Individual mode: Cost per item IS the per-piece figure
  // already — no division needed, and it doesn't depend on Qty at all.
  const costPerPiece =
    line.costMode === "individual"
      ? toNumber(line.costPerItem) > 0
        ? toNumber(line.costPerItem)
        : null
      : qty > 0 && toNumber(line.cost) > 0
        ? toNumber(line.cost) / qty
        : null;
  const suggested = costPerPiece !== null ? sellingPriceFor(costPerPiece) : null;

  if (collapsed) {
    const displayName =
      (line.productId ? line.productName : line.newName.trim()) || "New item";
    const price = toNumber(line.price);
    const totalCost = totalCostFor(line);
    const summary = !isLineComplete(line)
      ? "Incomplete — tap to finish"
      : qty > 0 && totalCost > 0
        ? `${qty} pc${qty === 1 ? "" : "s"} · ${formatPeso(totalCost)} → ${formatPeso(price)}`
        : `${formatPeso(price)} · not stocked yet`;

    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {displayName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {summary}
            </span>
          </span>
        </button>
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove this item from the cart"
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
    );
  }

  function handleProductChange(option: PickerOption | null) {
    if (!option || option.value === "__new__") {
      onChange({
        productId: null,
        productName: "",
        price: "",
        priceTouched: false,
        costTouched: false,
        categoryId: "",
        description: "",
      });
      return;
    }
    const product = products.find((p) => p.id === option.value);
    onChange({
      productId: option.value,
      productName: product?.name ?? "",
      price: product ? String(product.price) : "",
      priceTouched: false,
      costTouched: false,
      categoryId: "",
      description: "",
    });
  }

  // New-item lines only: whichever of Cost/Price hasn't been typed into
  // directly gets auto-filled from the markup calculator as the other two
  // fields change. Existing-item lines never auto-fill — restocking
  // shouldn't silently change a real price. Individual mode's Cost per item
  // is quantity-independent (it's already a per-piece figure), so only pack
  // mode's Cost (a total) needs Qty in the math at all.
  function handleQuantityChange(value: string) {
    const patch: Partial<CartLine> = { quantity: value };
    if (line.productId === null && line.costMode === "pack") {
      const q = toNumber(value);
      if (line.priceTouched && !line.costTouched) {
        const p = toNumber(line.price);
        if (p > 0 && q > 0) patch.cost = String(costFor(p, q));
      } else if (!line.priceTouched) {
        const c = toNumber(line.cost);
        if (c > 0 && q > 0) patch.price = String(sellingPriceFor(c / q));
      }
    }
    onChange(patch);
  }

  function handleCostChange(value: string) {
    const patch: Partial<CartLine> = { cost: value, costTouched: true };
    if (line.productId === null && !line.priceTouched) {
      const c = toNumber(value);
      const q = toNumber(line.quantity);
      if (c > 0 && q > 0) patch.price = String(sellingPriceFor(c / q));
    }
    onChange(patch);
  }

  function handleCostPerItemChange(value: string) {
    const patch: Partial<CartLine> = { costPerItem: value, costTouched: true };
    if (line.productId === null && !line.priceTouched) {
      const c = toNumber(value);
      if (c > 0) patch.price = String(sellingPriceFor(c));
    }
    onChange(patch);
  }

  function handlePriceChange(value: string) {
    const patch: Partial<CartLine> = { price: value, priceTouched: true };
    if (line.productId === null && !line.costTouched) {
      const p = toNumber(value);
      const q = toNumber(line.quantity);
      if (line.costMode === "individual") {
        if (p > 0) patch.costPerItem = String(costPerPieceFor(p));
      } else if (p > 0 && q > 0) {
        patch.cost = String(costFor(p, q));
      }
    }
    onChange(patch);
  }

  // Switching modes clears both cost inputs rather than trying to convert
  // between them — less surprising than a stale pack total silently
  // reappearing as a per-item figure (or vice versa) if the cashier toggles
  // back later. costTouched resets too, so the newly active field can
  // auto-fill the suggested price fresh.
  function handleCostModeChange(mode: CostMode) {
    onChange({ costMode: mode, cost: "", costPerItem: "", costTouched: false });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        <div className="mt-5 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse this item"
            onClick={onToggleCollapse}
          >
            <ChevronDownIcon />
          </Button>
          {removable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove this item from the cart"
              onClick={onRemove}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </div>

      {line.productId === null ? (
        <>
          <div className="flex flex-col gap-1">
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

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`category-${line.key}`} className="text-xs">
                Category
              </Label>
              <Select
                id={`category-${line.key}`}
                value={line.categoryId}
                onChange={(event) => onChange({ categoryId: event.target.value })}
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
              <Label htmlFor={`description-${line.key}`} className="text-xs">
                Description
              </Label>
              <Input
                id={`description-${line.key}`}
                placeholder="Optional"
                value={line.description}
                onChange={(event) => onChange({ description: event.target.value })}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Bought as</Label>
        <Tabs
          value={line.costMode}
          onValueChange={(value) => handleCostModeChange(value as CostMode)}
          className="w-full min-w-0"
        >
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="pack">Pack</TabsTrigger>
            <TabsTrigger value="individual">Individually</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`qty-${line.key}`} className="text-xs">
            Qty
          </Label>
          <Input
            id={`qty-${line.key}`}
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            required={line.productId !== null}
            placeholder={line.productId === null ? "Optional" : "6"}
            value={line.quantity}
            onChange={(event) => handleQuantityChange(event.target.value)}
          />
        </div>
        {line.costMode === "individual" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`cost-per-item-${line.key}`} className="text-xs">
              Cost/item
            </Label>
            <Input
              id={`cost-per-item-${line.key}`}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              required={line.productId !== null || qty > 0}
              placeholder={line.productId === null ? "Optional" : "15.00"}
              value={line.costPerItem}
              onChange={(event) => handleCostPerItemChange(event.target.value)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`cost-${line.key}`} className="text-xs">
              Cost
            </Label>
            <Input
              id={`cost-${line.key}`}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              required={line.productId !== null || qty > 0}
              placeholder={line.productId === null ? "Optional" : "60.00"}
              value={line.cost}
              onChange={(event) => handleCostChange(event.target.value)}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`price-${line.key}`} className="text-xs">
            Price
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
            onChange={(event) => handlePriceChange(event.target.value)}
          />
        </div>
      </div>

      {costPerPiece !== null && suggested !== null ? (
        <p className="text-xs">
          <span className="font-medium">
            {formatPeso(costPerPiece)}/pc
          </span>
          <span className="text-muted-foreground"> · suggested </span>
          <span className="font-medium">{formatPeso(suggested)}</span>
          {line.productId === null && !line.priceTouched ? null : (
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
    </div>
  );
}

export default function BulkRestockForm({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
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
      costMode: "pack",
      cost: "",
      costPerItem: "",
      price: "",
      priceTouched: false,
      costTouched: false,
      categoryId: "",
      description: "",
    },
  ]);
  // Gates the persist effect below so it never fires before the restore
  // effect has had a chance to run — otherwise the freshly-mounted default
  // (one blank line) would overwrite a real saved draft on the very first
  // render, before React even gets a chance to restore it.
  const [hydrated, setHydrated] = useState(false);
  const [justRestored, setJustRestored] = useState(false);
  // Ephemeral UI state, not persisted — an accordion: at most one line is
  // expanded at a time, everything else collapses to a one-line summary, so
  // the cart stays short no matter how many items are in it. null means
  // every line is collapsed.
  const [expandedKey, setExpandedKey] = useState<string | null>("initial");

  // Restore a saved draft on mount. localStorage isn't available during SSR,
  // so this only ever runs client-side, after hydration — a normal post-
  // mount state update, not a hydration-time mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidCartLine)) {
          // A draft saved before costMode/costPerItem existed won't have
          // them — default to "pack" (the old field's only prior meaning)
          // rather than rejecting the whole draft.
          const normalized: CartLine[] = parsed.map((line) => ({
            ...line,
            costMode: line.costMode === "individual" ? "individual" : "pack",
            costPerItem: typeof line.costPerItem === "string" ? line.costPerItem : "",
          }));
          // A line's product may have been deleted since the draft was
          // saved — fall back to a "new item" line using the last-known
          // name rather than silently pointing at nothing.
          const reconciled = normalized.map((line) =>
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
            // The last line is the most likely one to have been mid-edit
            // when the draft was saved — everything else starts collapsed.
            setExpandedKey(reconciled[reconciled.length - 1].key);
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
    setExpandedKey((prev) => (prev === key ? null : prev));
  }

  function toggleExpand(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  function addLine() {
    // The new blank line becomes the sole expanded one — everything already
    // filled in collapses, so the cart doesn't just keep growing taller.
    const line = emptyLine();
    setLines((prev) => [...prev, line]);
    setExpandedKey(line.key);
  }

  function clearCart() {
    const line = emptyLine();
    setLines([line]);
    setJustRestored(false);
    setExpandedKey(line.key);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage isn't available.
    }
  }

  const hasContent = lines.some(hasAnyContent);

  const total = lines.reduce((sum, line) => sum + totalCostFor(line), 0);
  const pieceCount = lines.reduce(
    (sum, line) => sum + toNumber(line.quantity),
    0
  );

  const hasIncompleteLine = lines.some((line) => !isLineComplete(line));

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
            cost: costPayloadFor(line),
            price: line.price,
            category_id: line.productId ? null : line.categoryId || null,
            description: line.productId ? null : line.description.trim() || null,
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

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {lines.map((line) => (
          <CartLineCard
            key={line.key}
            line={line}
            products={products}
            categories={categories}
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
            collapsed={line.key !== expandedKey}
            onToggleCollapse={() => toggleExpand(line.key)}
          />
        ))}

        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={addLine}
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
