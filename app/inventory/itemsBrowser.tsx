"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState } from "@/components/emptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, Product } from "@/lib/types";
import DeleteButton from "./deleteButton";

const UNCATEGORIZED = "__none__";

function StockLabel({ value }: { value: number | null }) {
  // NULL and 0 are different states and must not read the same;
  // negative means oversold and needs a recount.
  if (value === null) {
    return <span className="text-muted-foreground">not counted</span>;
  }
  if (value === 0) {
    return <span className="text-destructive">out of stock</span>;
  }
  if (value < 0) {
    return (
      <span className="text-destructive tabular-nums">{value} · recount</span>
    );
  }
  return <span className="tabular-nums">{value} in stock</span>;
}

function ItemRow({ product }: { product: Product }) {
  return (
    <div className="-mx-2 flex items-center justify-between gap-2 border-b px-2 py-2.5 transition-colors last:border-b-0 hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{product.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatPeso(Number(product.price))} ·{" "}
          <StockLabel value={product.stock} />
        </p>
        {product.description ? (
          <p className="truncate text-xs text-muted-foreground">
            {product.description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          nativeButton={false}
          render={<Link href={`/inventory?history=${product.id}`} />}
        >
          History
        </Button>
        <Button
          variant="ghost"
          size="xs"
          nativeButton={false}
          render={<Link href={`/inventory?edit=${product.id}`} />}
        >
          Edit
        </Button>
        <DeleteButton id={product.id} name={product.name} />
      </div>
    </div>
  );
}

/**
 * Searchable, category-filtered inventory list, grouped into one card per
 * category. Chips toggle a single category; "All" shows every group.
 */
export default function ItemsBrowser({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const needle = search.trim().toLowerCase();
  const searched = useMemo(
    () =>
      needle === ""
        ? products
        : products.filter(
            (product) =>
              product.name.toLowerCase().includes(needle) ||
              (product.description ?? "").toLowerCase().includes(needle)
          ),
    [products, needle]
  );

  // Group into category buckets, in the categories' own sort order, with
  // uncategorized items last. Empty groups are dropped.
  const groups = useMemo(() => {
    const byCategory = new Map<string, Product[]>();
    for (const product of searched) {
      const key = product.category_id ?? UNCATEGORIZED;
      const bucket = byCategory.get(key);
      if (bucket) bucket.push(product);
      else byCategory.set(key, [product]);
    }

    const ordered: { key: string; name: string; items: Product[] }[] = [];
    for (const category of categories) {
      const items = byCategory.get(category.id);
      if (items?.length) {
        ordered.push({ key: category.id, name: category.name, items });
      }
    }
    const loose = byCategory.get(UNCATEGORIZED);
    if (loose?.length) {
      ordered.push({ key: UNCATEGORIZED, name: "No category", items: loose });
    }
    return ordered;
  }, [searched, categories]);

  const visibleGroups =
    activeCategory === "all"
      ? groups
      : groups.filter((group) => group.key === activeCategory);

  // Chips only for categories that actually hold items (pre-search), so the
  // filter row never offers an empty result.
  const chipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const key = product.category_id ?? UNCATEGORIZED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [products]);

  const chips: { key: string; label: string }[] = [
    { key: "all", label: `All (${products.length})` },
    ...categories
      .filter((category) => chipCounts.has(category.id))
      .map((category) => ({
        key: category.id,
        label: `${category.name} (${chipCounts.get(category.id)})`,
      })),
    ...(chipCounts.has(UNCATEGORIZED)
      ? [
          {
            key: UNCATEGORIZED,
            label: `No category (${chipCounts.get(UNCATEGORIZED)})`,
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        type="search"
        aria-label="Search inventory"
        placeholder="Search items…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={activeCategory === chip.key}
            onClick={() =>
              setActiveCategory((prev) =>
                prev === chip.key ? "all" : chip.key
              )
            }
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              activeCategory === chip.key
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:bg-muted/50"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState
          title={
            products.length === 0
              ? "No items yet."
              : `No items match${needle ? ` “${search.trim()}”` : ""}.`
          }
          subtitle={
            products.length === 0
              ? "Add your first one to start ringing up sales."
              : undefined
          }
        />
      ) : (
        visibleGroups.map((group) => (
          <section
            key={group.key}
            className="rounded-lg border bg-card px-4 py-2"
          >
            <div className="flex items-baseline justify-between border-b pb-2 pt-1">
              <h3 className="text-sm font-semibold">{group.name}</h3>
              <Badge>{group.items.length}</Badge>
            </div>
            {group.items.map((product) => (
              <ItemRow key={product.id} product={product} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
