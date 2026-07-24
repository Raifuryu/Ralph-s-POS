"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type Product,
} from "@/lib/types";
import { isShort } from "../changeCalculator";
import { recordSale, type CheckoutState } from "./actions";
import ItemPickerDrawer from "./itemPickerDrawer";

const initialState: CheckoutState = { error: null };

/** Same parsing ChangeCalculator uses — duplicated locally rather than
    exported from there, since this drawer is the only place that needs the
    "Customer gave" input and its change/short readout positioned apart from
    each other (beside the payment method tabs vs. down in the footer) rather
    than stacked together the way ChangeCalculator renders them everywhere
    else (e.g. the service drawer). */
function toAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function CheckoutForm({
  products,
  topProductIds,
  doneSlot,
  onRecorded,
}: {
  products: Product[];
  /** Product ids ranked by units sold, best first. Shown as quick picks. */
  topProductIds?: string[];
  /**
   * Rendered after a successful sale. Defaults to a link back to the
   * dashboard; the drawer passes a close button instead.
   */
  doneSlot?: React.ReactNode;
  /** Called shortly after a successful sale — the drawer closes itself
      instead of waiting on doneSlot's button. Omitted on the standalone
      /checkout page, which has no sheet to close. */
  onRecorded?: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  // Stock still leaves the shelf, but nothing was sold — no payment method,
  // no change to tender, no income. See app/checkout/actions.ts.
  const [personalTake, setPersonalTake] = useState(false);
  const [state, formAction, isPending] = useActionState(
    recordSale,
    initialState
  );

  // Brief delay so "Sale recorded." is actually readable before the sheet
  // closes — an instant close would make the confirmation flash by unseen.
  useEffect(() => {
    if (!state.transactionId || !onRecorded) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.transactionId, onRecorded]);

  // The cart is built from ALL products, not the filtered view — searching
  // must never silently drop items already added.
  const cart = useMemo(
    () =>
      products
        .map((product) => ({ product, quantity: quantities[product.id] ?? 0 }))
        .filter((line) => line.quantity > 0),
    [products, quantities]
  );

  // Lines selling more than the recorded stock. Allowed — the shelf is the
  // source of truth, not the system — but flagged and confirmed, and the
  // stock goes negative as the signal to recount.
  const oversoldLines = cart.filter(
    (line) =>
      line.product.stock !== null && line.quantity > line.product.stock
  );

  // Display only. The authoritative total is computed by the database.
  const previewTotal = cart.reduce(
    (sum, line) => sum + Number(line.product.price) * line.quantity,
    0
  );
  const pieceCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const insufficient =
    !personalTake && paymentMethod === "cash" && isShort(tendered, previewTotal);
  const tenderedAmount = toAmount(tendered);

  function setQuantity(id: string, next: number) {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, next) }));
  }

  if (products.length === 0) {
    return (
      <EmptyState
        title="No products yet."
        subtitle="Add items in Inventory first, then come back."
        action={
          <Link href="/inventory" className="text-sm underline">
            Go to Inventory
          </Link>
        }
      />
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (oversoldLines.length === 0) return;
        const detail = oversoldLines
          .map(
            (line) =>
              `${line.product.name}: selling ${line.quantity}, only ${line.product.stock} in stock`
          )
          .join("\n");
        const noun = personalTake ? "take" : "sale";
        if (
          !confirm(
            `This ${noun} exceeds recorded stock:\n\n${detail}\n\nRecord anyway? Stock will go negative so you can recount later.`
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <input
        type="hidden"
        name="cart"
        value={JSON.stringify(
          cart.map((line) => ({
            product_id: line.product.id,
            quantity: line.quantity,
          }))
        )}
      />
      {/* Omitted entirely (not just disabled) for a personal take, so
          formData.get("payment_method") comes back null server-side. */}
      {!personalTake ? (
        <input type="hidden" name="payment_method" value={paymentMethod} />
      ) : null}

      {/* Opens a separate full-height sheet to browse/add items — keeps
          catalogue browsing from being squeezed out by the cart, payment
          method, and change calculator below, which all need their own
          fixed space regardless of how many lines are in the cart. Tapping
          an item there adds one; tapping again adds another. Quantities are
          edited in the "In this sale" section below, not there. */}
      <ItemPickerDrawer
        products={products}
        topProductIds={topProductIds}
        quantities={quantities}
        onAdd={(id) => setQuantity(id, (quantities[id] ?? 0) + 1)}
        pieceCount={pieceCount}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
        <p className="text-sm font-medium">In this sale</p>
        {cart.length === 0 ? (
          <EmptyState title="No items yet." subtitle="Tap “Add items” above to get started." />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {cart.map((line) => {
              const oversold =
                line.product.stock !== null &&
                line.quantity > line.product.stock;
              return (
              <div
                key={line.product.id}
                data-oversold={oversold || undefined}
                className={
                  oversold
                    ? "flex items-center justify-between gap-2 rounded-lg border border-warning/60 bg-warning/10 p-2"
                    : "flex items-center justify-between gap-2"
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{line.product.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPeso(Number(line.product.price))} × {line.quantity}{" "}
                    = {formatPeso(Number(line.product.price) * line.quantity)}
                  </p>
                  {oversold ? (
                    <p className="text-xs font-medium text-warning">
                      Only {line.product.stock} in stock — will drop to{" "}
                      {line.product.stock! - line.quantity}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Remove one ${line.product.name}`}
                    onClick={() =>
                      setQuantity(line.product.id, line.quantity - 1)
                    }
                  >
                    <MinusIcon />
                  </Button>
                  <Input
                    aria-label={`Quantity of ${line.product.name}`}
                    inputMode="numeric"
                    className="w-12 text-center"
                    value={line.quantity}
                    onChange={(event) =>
                      setQuantity(
                        line.product.id,
                        Number.parseInt(event.target.value, 10) || 0
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Add one ${line.product.name}`}
                    onClick={() =>
                      setQuantity(line.product.id, line.quantity + 1)
                    }
                  >
                    <PlusIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${line.product.name} from sale`}
                    onClick={() => setQuantity(line.product.id, 0)}
                  >
                    <XIcon />
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <label className="flex items-start gap-1 rounded-lg border p-1 text-xs has-[[data-checked]]:border-ring has-[[data-checked]]:bg-muted/30">
        <Checkbox
          name="personal_take"
          value="on"
          checked={personalTake}
          onCheckedChange={setPersonalTake}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Personal take (Utang)</span>
        </span>
      </label>

      {!personalTake ? (
        // 65/35 fr split — payment method gets 65%, Customer gave gets
        // 35% — rather than content-sized, so the split holds steady
        // regardless of how wide "GCash"/"Maya" render.
        <div className="grid grid-cols-[65fr_35fr] items-end gap-3">
          <div
            className={
              paymentMethod === "cash"
                ? "flex flex-col gap-2"
                : "col-span-2 flex flex-col gap-2"
            }
          >
            <Label className="text-xs">Payment method</Label>
            <Tabs
              value={paymentMethod}
              onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
              className="w-full min-w-0"
            >
              <TabsList className="w-full sm:w-fit">
                {PAYMENT_METHODS.map((method) => (
                  <TabsTrigger key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Cash only. Unmounting on wallet payments also removes the input
              from the form, so nothing stray is submitted. */}
          {paymentMethod === "cash" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tendered" className="text-xs">
                Customer gave
              </Label>
              <Input
                id="tendered"
                name="tendered"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="Blank if exact"
                value={tendered}
                onChange={(event) => setTendered(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state.transactionId ? (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span>{personalTake ? "Take recorded." : "Sale recorded."}</span>
          {doneSlot ?? (
            <Link href="/" className="underline">
              Back to sales
            </Link>
          )}
        </div>
      ) : null}

      <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-0 pt-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {personalTake ? "Value taken" : "Total"}
            {pieceCount > 0
              ? ` · ${pieceCount} pc${pieceCount === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(previewTotal)}
          </p>
        </div>
        {!personalTake && paymentMethod === "cash" && tenderedAmount !== null ? (
          <div data-testid="change-line" className="text-right">
            {tenderedAmount < previewTotal ? (
              <p className="text-sm font-medium text-destructive">
                Short {formatPeso(previewTotal - tenderedAmount)}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Change</p>
                <p className="text-xl font-semibold tabular-nums">
                  {formatPeso(tenderedAmount - previewTotal)}
                </p>
              </>
            )}
          </div>
        ) : null}
        <Button
          type="submit"
          disabled={isPending || cart.length === 0 || insufficient}
        >
          {isPending
            ? "Recording…"
            : personalTake
              ? "Record personal take"
              : "Record sale"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
