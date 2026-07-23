"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, Product } from "@/lib/types";
import DeleteButton from "./deleteButton";

const UNCATEGORIZED = "__none__";

type StockStatus = "ok" | "low" | "out";

/** Untracked (null) items are never flagged — there's nothing to compare
    against. 0 or negative (oversold, needs recount) always reads as "out,"
    regardless of any threshold — that's a fact, not a warning preference.
    "Low" only fires when the item has its own `low_stock_threshold` set —
    leaving it blank opts an item out of low-stock flagging entirely, rather
    than falling back to some store-wide number. */
function stockStatus(product: Pick<Product, "stock" | "low_stock_threshold">): StockStatus {
  const value = product.stock;
  if (value === null) return "ok";
  if (value <= 0) return "out";
  if (product.low_stock_threshold === null) return "ok";
  if (value <= product.low_stock_threshold) return "low";
  return "ok";
}

function StockLabel({
  value,
  status,
}: {
  value: number | null;
  status: StockStatus;
}) {
  // NULL and 0 are different states and must not read the same;
  // negative means oversold and needs a recount.
  if (value === null) {
    return <span className="text-muted-foreground">not counted</span>;
  }
  if (value < 0) {
    return (
      <span className="text-destructive tabular-nums">{value} · recount</span>
    );
  }
  if (status === "out") {
    return <span className="text-destructive">out of stock</span>;
  }
  if (status === "low") {
    return (
      <span className="text-warning tabular-nums">{value} in stock · low</span>
    );
  }
  return <span className="tabular-nums">{value} in stock</span>;
}

function ItemRow({ product }: { product: Product }) {
  const status = stockStatus(product);
  return (
    <div
      className={cn(
        "-mx-2 flex items-center justify-between gap-2 border-b border-l-4 border-l-transparent px-2 py-2.5 pl-3 transition-colors last:border-b-0 hover:bg-muted/50",
        status === "low" && "border-l-warning bg-warning/5",
        status === "out" && "border-l-destructive bg-destructive/5"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{product.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatPeso(Number(product.price))} ·{" "}
          <StockLabel value={product.stock} status={status} />
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

type StockFilter = "all" | "low" | "out";

const STOCK_FILTER_LABELS: Record<Exclude<StockFilter, "all">, string> = {
  low: "Low stock",
  out: "No stock",
};

function FilterChip({
  label,
  active,
  tone = "neutral",
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "neutral" | "warning" | "destructive";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        tone === "neutral" &&
          (active
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-transparent text-muted-foreground hover:bg-muted/50"),
        tone === "warning" &&
          (active
            ? "border-warning bg-warning text-white"
            : "border-warning/40 text-warning hover:bg-warning/10"),
        tone === "destructive" &&
          (active
            ? "border-destructive bg-destructive text-white"
            : "border-destructive/40 text-destructive hover:bg-destructive/10")
      )}
    >
      {label}
    </button>
  );
}

/**
 * Searchable, filterable inventory list — one flat list (no per-category
 * grouping; the category/stock chips are the grouping) so items with a
 * low/no-stock indicator are never split across separate cards.
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
  const [activeStockFilter, setActiveStockFilter] = useState<StockFilter>("all");

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

  const filtered = useMemo(
    () =>
      searched.filter((product) => {
        if (activeCategory !== "all") {
          const key = product.category_id ?? UNCATEGORIZED;
          if (key !== activeCategory) return false;
        }
        if (activeStockFilter !== "all") {
          if (stockStatus(product) !== activeStockFilter) return false;
        }
        return true;
      }),
    [searched, activeCategory, activeStockFilter]
  );

  // Chip counts come from the full (pre-search) product list, so the filter
  // row never offers a chip whose count is stale relative to what's typed.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const key = product.category_id ?? UNCATEGORIZED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [products]);

  const stockCounts = useMemo(() => {
    const counts: Record<Exclude<StockFilter, "all">, number> = { low: 0, out: 0 };
    for (const product of products) {
      const status = stockStatus(product);
      if (status === "low" || status === "out") counts[status] += 1;
    }
    return counts;
  }, [products]);

  const categoryChips: { key: string; label: string }[] = [
    { key: "all", label: `All (${products.length})` },
    ...categories
      .filter((category) => categoryCounts.has(category.id))
      .map((category) => ({
        key: category.id,
        label: `${category.name} (${categoryCounts.get(category.id)})`,
      })),
    ...(categoryCounts.has(UNCATEGORIZED)
      ? [
          {
            key: UNCATEGORIZED,
            label: `No category (${categoryCounts.get(UNCATEGORIZED)})`,
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
        {categoryChips.map((chip) => (
          <FilterChip
            key={chip.key}
            label={chip.label}
            active={activeCategory === chip.key}
            onClick={() =>
              setActiveCategory((prev) => (prev === chip.key ? "all" : chip.key))
            }
          />
        ))}
      </div>

      {stockCounts.low > 0 || stockCounts.out > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip
            label="All stock"
            active={activeStockFilter === "all"}
            onClick={() => setActiveStockFilter("all")}
          />
          {stockCounts.low > 0 ? (
            <FilterChip
              label={`${STOCK_FILTER_LABELS.low} (${stockCounts.low})`}
              active={activeStockFilter === "low"}
              tone="warning"
              onClick={() =>
                setActiveStockFilter((prev) => (prev === "low" ? "all" : "low"))
              }
            />
          ) : null}
          {stockCounts.out > 0 ? (
            <FilterChip
              label={`${STOCK_FILTER_LABELS.out} (${stockCounts.out})`}
              active={activeStockFilter === "out"}
              tone="destructive"
              onClick={() =>
                setActiveStockFilter((prev) => (prev === "out" ? "all" : "out"))
              }
            />
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
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
        <section className="rounded-lg border bg-card px-4 py-2">
          {filtered.map((product) => (
            <ItemRow key={product.id} product={product} />
          ))}
        </section>
      )}
    </div>
  );
}
