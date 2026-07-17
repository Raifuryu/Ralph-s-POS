"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { recordSale, type CheckoutState } from "./actions";

const initialState: CheckoutState = { error: null };

function CatalogueRow({
  product,
  quantity,
  onAdd,
}: {
  product: Product;
  quantity: number;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Add ${product.name}`}
      onClick={onAdd}
      className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{product.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatPeso(Number(product.price))}
          {/* stock === null means the item isn't counted, so there is no
              stock figure to show — distinct from 0. */}
          {product.stock !== null ? ` · ${product.stock} in stock` : null}
        </p>
        {product.description ? (
          <p className="truncate text-xs text-muted-foreground">
            {product.description}
          </p>
        ) : null}
      </div>

      {quantity > 0 ? (
        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          ×{quantity}
        </span>
      ) : (
        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

export default function CheckoutForm({
  products,
  topProductIds,
  doneSlot,
}: {
  products: Product[];
  /** Product ids ranked by units sold, best first. Shown as quick picks. */
  topProductIds?: string[];
  /**
   * Rendered after a successful sale. Defaults to a link back to the
   * dashboard; the drawer passes a close button instead.
   */
  doneSlot?: React.ReactNode;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [search, setSearch] = useState("");
  const [state, formAction, isPending] = useActionState(
    recordSale,
    initialState
  );

  // The cart is built from ALL products, not the filtered view — searching
  // must never silently drop items already added.
  const cart = useMemo(
    () =>
      products
        .map((product) => ({ product, quantity: quantities[product.id] ?? 0 }))
        .filter((line) => line.quantity > 0),
    [products, quantities]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.description ?? "").toLowerCase().includes(needle)
    );
  }, [products, search]);

  // Best sellers as quick picks, in ranking order. Hidden while searching —
  // the search results are the answer then. Ids referencing deleted or
  // deactivated products simply drop out.
  const topProducts = useMemo(() => {
    if (!topProductIds?.length) return [];
    const byId = new Map(products.map((product) => [product.id, product]));
    return topProductIds
      .map((id) => byId.get(id))
      .filter((product): product is Product => product !== undefined);
  }, [products, topProductIds]);

  const isSearching = search.trim().length > 0;

  // Display only. The authoritative total is computed by the database.
  const previewTotal = cart.reduce(
    (sum, line) => sum + Number(line.product.price) * line.quantity,
    0
  );
  const pieceCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  function setQuantity(id: string, next: number) {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, next) }));
  }

  if (products.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        No products yet. Add items in{" "}
        <Link href="/inventory" className="underline">
          Inventory
        </Link>{" "}
        first, then come back.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4">
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
      <input type="hidden" name="payment_method" value={paymentMethod} />

      <Input
        type="search"
        aria-label="Search items"
        placeholder="Search items…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          // Enter in the search box must never submit the form — on a POS,
          // that would record a sale by accident.
          if (event.key === "Enter") event.preventDefault();
        }}
      />

      {/* Catalogue: nothing here is in the sale until tapped. Tapping adds
          one; tapping again adds another. Quantities are edited in the
          "In this sale" section below, not here. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {isSearching ? (
          visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No items match &ldquo;{search.trim()}&rdquo;.
            </p>
          ) : (
            visible.map((product) => (
              <CatalogueRow
                key={product.id}
                product={product}
                quantity={quantities[product.id] ?? 0}
                onAdd={() =>
                  setQuantity(product.id, (quantities[product.id] ?? 0) + 1)
                }
              />
            ))
          )
        ) : (
          <>
            {topProducts.length > 0 ? (
              <>
                <p className="pt-1 text-xs font-medium text-muted-foreground">
                  Top items
                </p>
                {topProducts.map((product) => (
                  <CatalogueRow
                    key={`top-${product.id}`}
                    product={product}
                    quantity={quantities[product.id] ?? 0}
                    onAdd={() =>
                      setQuantity(
                        product.id,
                        (quantities[product.id] ?? 0) + 1
                      )
                    }
                  />
                ))}
                <p className="pt-2 text-xs font-medium text-muted-foreground">
                  All items
                </p>
              </>
            ) : null}
            {products.map((product) => (
              <CatalogueRow
                key={product.id}
                product={product}
                quantity={quantities[product.id] ?? 0}
                onAdd={() =>
                  setQuantity(product.id, (quantities[product.id] ?? 0) + 1)
                }
              />
            ))}
          </>
        )}
      </div>

      {cart.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-2 border-t pt-3">
          <p className="text-sm font-medium">In this sale</p>
          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
            {cart.map((line) => (
              <div
                key={line.product.id}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{line.product.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPeso(Number(line.product.price))} × {line.quantity}{" "}
                    = {formatPeso(Number(line.product.price) * line.quantity)}
                  </p>
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
                    −
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
                    +
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
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-col gap-2">
        <Label>Payment method</Label>
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

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state.transactionId ? (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span>Sale recorded.</span>
          {doneSlot ?? (
            <Link href="/" className="underline">
              Back to sales
            </Link>
          )}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Total
            {pieceCount > 0
              ? ` · ${pieceCount} pc${pieceCount === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(previewTotal)}
          </p>
        </div>
        <Button type="submit" disabled={isPending || cart.length === 0}>
          {isPending ? "Recording…" : "Record sale"}
        </Button>
      </div>
    </form>
  );
}
