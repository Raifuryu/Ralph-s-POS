"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState } from "@/components/emptyState";
import { FilterChip } from "@/components/filterChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatPeso, storeDayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, Product } from "@/lib/types";
import CategoryFilterDropdown, {
  type CategoryOption,
} from "./categoryFilterDropdown";
import DeleteButton from "./deleteButton";

const UNCATEGORIZED = "__none__";

/** How far ahead "expiring soon" looks — generous on purpose for a
    sari-sari store restocking on its own schedule, not a daily delivery. */
const EXPIRING_SOON_DAYS = 30;

/** Rendered rows are capped and revealed in batches — unlike Vault/Sales,
    this list's search/category/stock filtering is instant and client-side
    over the *whole* catalog (no server round-trip per keystroke), so the
    full product list still has to be fetched and kept in memory either way.
    What actually costs something as the catalog grows is hydrating/painting
    hundreds of DOM rows at once — this caps that without touching search. */
const PAGE_SIZE = 50;

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

type ExpiryStatus = "ok" | "expiring" | "expired";

/** No expiry_date means the item never gets flagged — same "opt in by
    setting it" reasoning as low_stock_threshold. expiry_date is a plain
    date (no time/timezone), and todayKey/soonKey are both "YYYY-MM-DD" in
    the store's own timezone (see storeDayKey), so a plain string compare
    is correct and avoids any Date-parsing timezone pitfalls. */
function expiryStatus(
  product: Pick<Product, "expiry_date">,
  todayKey: string,
  soonKey: string
): ExpiryStatus {
  if (!product.expiry_date) return "ok";
  if (product.expiry_date < todayKey) return "expired";
  if (product.expiry_date <= soonKey) return "expiring";
  return "ok";
}

function ExpiryLabel({
  value,
  status,
}: {
  value: string;
  status: ExpiryStatus;
}) {
  if (status === "expired") {
    return <span className="text-destructive">expired {formatDate(value)}</span>;
  }
  if (status === "expiring") {
    return <span className="text-warning">expires {formatDate(value)}</span>;
  }
  return <span className="text-muted-foreground">expires {formatDate(value)}</span>;
}

function ItemRow({
  product,
  todayKey,
  soonKey,
}: {
  product: Product;
  todayKey: string;
  soonKey: string;
}) {
  const stock = stockStatus(product);
  const expiry = expiryStatus(product, todayKey, soonKey);
  // One border color reflecting whichever dimension is more urgent about
  // this row — expired/out of stock outrank expiring-soon/low, which
  // outrank a plain "ok" on both.
  const status =
    expiry === "expired" || stock === "out"
      ? "destructive"
      : expiry === "expiring" || stock === "low"
        ? "warning"
        : "ok";
  return (
    <div
      className={cn(
        "-mx-2 flex items-center justify-between gap-2 border-b border-l-4 border-l-transparent px-2 py-2.5 pl-3 transition-colors last:border-b-0 hover:bg-muted/50",
        status === "warning" && "border-l-warning bg-warning/5",
        status === "destructive" && "border-l-destructive bg-destructive/5"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{product.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatPeso(Number(product.price))} ·{" "}
          <StockLabel value={product.stock} status={stock} />
        </p>
        {product.expiry_date ? (
          <p className="text-xs">
            <ExpiryLabel value={product.expiry_date} status={expiry} />
          </p>
        ) : null}
        {product.cost === null ? (
          <p className="text-xs text-muted-foreground">
            Cost not recorded — restock it to set one
          </p>
        ) : null}
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

type ExpiryFilter = "all" | "expiring" | "expired";

const EXPIRY_FILTER_LABELS: Record<Exclude<ExpiryFilter, "all">, string> = {
  expiring: "Expiring soon",
  expired: "Expired",
};

/** An item only gets a recorded cost once it's been restocked through the
    app at least once — until then it can't contribute to Total invested /
    Potential profit on this page, so this filter is how the owner finds
    which items still need a restock to fix that. */
type CostFilter = "all" | "missing";

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
  // Empty set means "all" — no category filter active. A product only has
  // one category (category_id is a single FK, no schema for more), but
  // browsing "Food" and "Drinks" together is a common enough ask that the
  // filter itself allows picking several at once.
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set()
  );
  const [activeStockFilter, setActiveStockFilter] = useState<StockFilter>("all");
  const [activeExpiryFilter, setActiveExpiryFilter] = useState<ExpiryFilter>("all");
  const [activeCostFilter, setActiveCostFilter] = useState<CostFilter>("all");

  const needle = search.trim().toLowerCase();

  // Computed once per mount rather than per row — todayKey anchors
  // "expired", soonKey (today + EXPIRING_SOON_DAYS) anchors "expiring soon".
  const { todayKey, soonKey } = useMemo(() => {
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
    return { todayKey: storeDayKey(now), soonKey: storeDayKey(soon) };
  }, []);

  // Narrowing the filter should always start back at the top of the
  // (now-shorter) matching list, not leave a stale "load more" position from
  // whatever was scrolled to under the previous filter. Adjusted during
  // render (React's recommended pattern for "reset state when an input
  // changes") rather than an effect, which would cost an extra render pass.
  const filterKey = `${needle} ${[...activeCategories].sort().join(",")} ${activeStockFilter} ${activeExpiryFilter} ${activeCostFilter}`;
  const [visible, setVisible] = useState({ key: filterKey, count: PAGE_SIZE });
  if (visible.key !== filterKey) {
    setVisible({ key: filterKey, count: PAGE_SIZE });
  }
  const visibleCount = visible.key === filterKey ? visible.count : PAGE_SIZE;
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
        if (activeCategories.size > 0) {
          const key = product.category_id ?? UNCATEGORIZED;
          if (!activeCategories.has(key)) return false;
        }
        if (activeStockFilter !== "all") {
          if (stockStatus(product) !== activeStockFilter) return false;
        }
        if (activeExpiryFilter !== "all") {
          if (expiryStatus(product, todayKey, soonKey) !== activeExpiryFilter) {
            return false;
          }
        }
        if (activeCostFilter === "missing" && product.cost !== null) {
          return false;
        }
        return true;
      }),
    [
      searched,
      activeCategories,
      activeStockFilter,
      activeExpiryFilter,
      activeCostFilter,
      todayKey,
      soonKey,
    ]
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

  const expiryCounts = useMemo(() => {
    const counts: Record<Exclude<ExpiryFilter, "all">, number> = {
      expiring: 0,
      expired: 0,
    };
    for (const product of products) {
      const status = expiryStatus(product, todayKey, soonKey);
      if (status === "expiring" || status === "expired") counts[status] += 1;
    }
    return counts;
  }, [products, todayKey, soonKey]);

  const missingCostCount = useMemo(
    () => products.filter((product) => product.cost === null).length,
    [products]
  );

  const categoryOptions: CategoryOption[] = [
    ...categories
      .filter((category) => categoryCounts.has(category.id))
      .map((category) => ({
        key: category.id,
        name: category.name,
        count: categoryCounts.get(category.id) ?? 0,
      })),
    ...(categoryCounts.has(UNCATEGORIZED)
      ? [
          {
            key: UNCATEGORIZED,
            name: "No category",
            count: categoryCounts.get(UNCATEGORIZED) ?? 0,
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

      <CategoryFilterDropdown
        options={categoryOptions}
        totalCount={products.length}
        active={activeCategories}
        onChange={setActiveCategories}
      />

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

      {expiryCounts.expiring > 0 || expiryCounts.expired > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip
            label="All expiry"
            active={activeExpiryFilter === "all"}
            onClick={() => setActiveExpiryFilter("all")}
          />
          {expiryCounts.expiring > 0 ? (
            <FilterChip
              label={`${EXPIRY_FILTER_LABELS.expiring} (${expiryCounts.expiring})`}
              active={activeExpiryFilter === "expiring"}
              tone="warning"
              onClick={() =>
                setActiveExpiryFilter((prev) =>
                  prev === "expiring" ? "all" : "expiring"
                )
              }
            />
          ) : null}
          {expiryCounts.expired > 0 ? (
            <FilterChip
              label={`${EXPIRY_FILTER_LABELS.expired} (${expiryCounts.expired})`}
              active={activeExpiryFilter === "expired"}
              tone="destructive"
              onClick={() =>
                setActiveExpiryFilter((prev) =>
                  prev === "expired" ? "all" : "expired"
                )
              }
            />
          ) : null}
        </div>
      ) : null}

      {missingCostCount > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip
            label="All cost"
            active={activeCostFilter === "all"}
            onClick={() => setActiveCostFilter("all")}
          />
          <FilterChip
            label={`No cost recorded (${missingCostCount})`}
            active={activeCostFilter === "missing"}
            tone="warning"
            onClick={() =>
              setActiveCostFilter((prev) => (prev === "missing" ? "all" : "missing"))
            }
          />
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
        <>
          <section className="rounded-lg border bg-card px-4 py-2">
            {filtered.slice(0, visibleCount).map((product) => (
              <ItemRow
                key={product.id}
                product={product}
                todayKey={todayKey}
                soonKey={soonKey}
              />
            ))}
          </section>
          {filtered.length > visibleCount ? (
            <Button
              variant="outline"
              className="self-center"
              onClick={() =>
                setVisible((prev) => ({ ...prev, count: prev.count + PAGE_SIZE }))
              }
            >
              Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
              ({filtered.length - visibleCount} left)
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
