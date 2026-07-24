"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

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
        <Badge variant="primary" className="shrink-0">
          ×{quantity}
        </Badge>
      ) : (
        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * Browsing the catalogue used to live inline in CheckoutForm, competing for
 * the same fixed drawer height as the cart, payment method, and change
 * calculator. Once the cart grew past a couple of lines those fixed-size
 * blocks squeezed the catalogue down to nothing on phones, making it
 * impossible to pick another item. A separate full-height sheet gives
 * browsing its own space regardless of how large the cart gets.
 */
export default function ItemPickerDrawer({
  products,
  topProductIds,
  quantities,
  onAdd,
  pieceCount,
}: {
  products: Product[];
  /** Product ids ranked by units sold, best first. Shown as quick picks. */
  topProductIds?: string[];
  quantities: Record<string, number>;
  onAdd: (productId: string) => void;
  pieceCount: number;
}) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.description ?? "").toLowerCase().includes(needle)
    );
  }, [products, search]);

  const isSearching = search.trim().length > 0;

  // Best sellers as quick picks, in ranking order, pulled out of the "All
  // items" list below so nothing is shown twice.
  const topProducts = useMemo(() => {
    if (!topProductIds?.length) return [];
    const byId = new Map(products.map((product) => [product.id, product]));
    return topProductIds
      .map((id) => byId.get(id))
      .filter((product): product is Product => product !== undefined);
  }, [products, topProductIds]);
  const topIds = useMemo(
    () => new Set(topProducts.map((product) => product.id)),
    [topProducts]
  );
  const rest = useMemo(
    () => visible.filter((product) => !topIds.has(product.id)),
    [visible, topIds]
  );

  return (
    <Drawer>
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: pieceCount > 0 ? "outline" : "default" }),
          "w-full justify-between"
        )}
      >
        <span>Add items</span>
        {pieceCount > 0 ? (
          <Badge variant="primary">
            {pieceCount} pc{pieceCount === 1 ? "" : "s"} added
          </Badge>
        ) : (
          <PlusIcon />
        )}
      </DrawerTrigger>

      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Add items</DrawerTitle>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-2">
          <Input
            type="search"
            aria-label="Search items"
            placeholder="Search items…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {visible.length === 0 ? (
              <EmptyState title={`No items match “${search.trim()}”.`} />
            ) : (
              <>
                {!isSearching && topProducts.length > 0 ? (
                  <>
                    <p className="pt-1 text-xs font-medium text-muted-foreground">
                      Top items
                    </p>
                    {topProducts.map((product) => (
                      <CatalogueRow
                        key={`top-${product.id}`}
                        product={product}
                        quantity={quantities[product.id] ?? 0}
                        onAdd={() => onAdd(product.id)}
                      />
                    ))}
                    <p className="pt-2 text-xs font-medium text-muted-foreground">
                      All items
                    </p>
                  </>
                ) : null}
                {rest.map((product) => (
                  <CatalogueRow
                    key={product.id}
                    product={product}
                    quantity={quantities[product.id] ?? 0}
                    onAdd={() => onAdd(product.id)}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <DrawerFooter className="flex-row items-center justify-between border-t">
          <p className="text-sm text-muted-foreground">
            {pieceCount > 0
              ? `${pieceCount} pc${pieceCount === 1 ? "" : "s"} added`
              : "No items added yet"}
          </p>
          <DrawerClose className={buttonVariants()}>Done</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
