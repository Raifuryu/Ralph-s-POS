"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import MultiSelectDropdown, {
  type MultiSelectOption,
} from "@/components/multiSelectDropdown";

/**
 * Narrows the whole page down to just the selected categories/products/
 * services — every summary card, chart, and table on Statistics recomputes
 * from only matching transaction_items/service_transactions (see page.tsx's
 * matchesItemFilter/matchesServiceFilter). Applies immediately on each
 * check, same "button click = instant action" philosophy TransactionFilters'
 * own preset/nav buttons already follow — this isn't buffered behind a
 * separate Apply button.
 *
 * Category/Product are one facet (a product's own category); Service is a
 * separate, unrelated facet — see page.tsx for what happens when only one
 * side is picked (the other drops out entirely rather than showing
 * whole-store numbers next to filtered ones).
 *
 * Deliberately its own component rather than folded into TransactionFilters
 * — that component is shared by Sales and Vault too, neither of which have
 * a category/product/service concept, so this stays Statistics-only.
 */
export default function ProductScopeFilter({
  categoryOptions,
  productOptions,
  serviceOptions,
  initialCategories,
  initialProducts,
  initialServices,
  basePath,
  preserveParams,
}: {
  categoryOptions: MultiSelectOption[];
  productOptions: MultiSelectOption[];
  serviceOptions: MultiSelectOption[];
  initialCategories: string[];
  initialProducts: string[];
  initialServices: string[];
  basePath: string;
  /** Every other active param (from/to/from_ts/to_ts) — carried through
      untouched so picking a category never resets the date range. */
  preserveParams: Record<string, string>;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(new Set(initialCategories));
  const [products, setProducts] = useState(new Set(initialProducts));
  const [services, setServices] = useState(new Set(initialServices));

  const hasSelection =
    categories.size > 0 || products.size > 0 || services.size > 0;

  function apply(
    nextCategories: Set<string>,
    nextProducts: Set<string>,
    nextServices: Set<string>
  ) {
    const params = new URLSearchParams(preserveParams);
    if (nextCategories.size > 0) {
      params.set("categories", [...nextCategories].join(","));
    }
    if (nextProducts.size > 0) {
      params.set("products", [...nextProducts].join(","));
    }
    if (nextServices.size > 0) {
      params.set("services", [...nextServices].join(","));
    }
    router.push(params.size ? `${basePath}?${params}` : basePath);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelectDropdown
        label="Category"
        options={categoryOptions}
        active={categories}
        onChange={(next) => {
          setCategories(next);
          apply(next, products, services);
        }}
      />
      <MultiSelectDropdown
        label="Product"
        options={productOptions}
        active={products}
        onChange={(next) => {
          setProducts(next);
          apply(categories, next, services);
        }}
      />
      <MultiSelectDropdown
        label="Service"
        options={serviceOptions}
        active={services}
        onChange={(next) => {
          setServices(next);
          apply(categories, products, next);
        }}
      />
      {hasSelection ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setCategories(new Set());
            setProducts(new Set());
            setServices(new Set());
            apply(new Set(), new Set(), new Set());
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}
