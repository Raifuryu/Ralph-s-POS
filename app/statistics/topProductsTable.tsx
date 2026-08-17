"use client";

import { useState } from "react";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPeso } from "@/lib/format";

const PAGE_SIZE = 50;

export type TopProduct = {
  key: string;
  name: string;
  units: number;
  revenue: number;
  /** Net profit for this product/service across the window — null when no
      line contributing to it has a known unit_cost (see the margin comment
      in app/statistics/page.tsx), undefined for rows with no cost concept
      at all (e.g. e-service fees, where the fee itself is the margin). */
  profit?: number | null;
};

/** Self-contained card (own border/title), matching MoneyBreakdownCard's
    recipe so every section on the statistics page reads the same. Reused
    for both "Products" and the e-service breakdown — neither is curated by
    the caller anymore, every product/service sold in the window is here,
    which can genuinely run past one page for a store with many products or
    many load/Xerox variants; the "show more" button reveals the rest a page
    at a time, same load-more pattern as everywhere else in this app. */
export default function TopProductsTable({
  title,
  products,
  itemHeader = "Product",
  unitsHeader = "Units",
  emptyTitle = "No sales in this window yet.",
}: {
  title: string;
  products: TopProduct[];
  itemHeader?: string;
  unitsHeader?: string;
  emptyTitle?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Always summed over every row, not just the ones currently revealed by
  // "show more" — the point of a total is to answer "how much does the
  // whole table add up to," which shouldn't depend on how far the cashier
  // has scrolled. Profit is only totaled (and only shown) when at least one
  // row actually has one — e-service rows never carry a `profit` at all
  // (the fee itself already is 100% margin, nothing to compute), and mixing
  // in a partial sum there would misleadingly imply cost data exists.
  const totalUnits = products.reduce((sum, p) => sum + p.units, 0);
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0);
  const rowsWithProfit = products.filter((p) => p.profit != null);
  const totalProfit =
    rowsWithProfit.length > 0
      ? rowsWithProfit.reduce((sum, p) => sum + (p.profit ?? 0), 0)
      : null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-sm text-muted-foreground">{title}</p>
      {products.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{itemHeader}</TableHead>
                <TableHead className="text-right">{unitsHeader}</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.slice(0, visibleCount).map((product) => (
                <TableRow key={product.key}>
                  <TableCell className="max-w-40 truncate whitespace-normal">
                    {product.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {product.units}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPeso(product.revenue)}
                    {product.profit != null ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({product.profit >= 0 ? "+" : "-"}
                        {formatPeso(Math.abs(product.profit))})
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {totalUnits}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPeso(totalRevenue)}
                  {totalProfit !== null ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({totalProfit >= 0 ? "+" : "-"}
                      {formatPeso(Math.abs(totalProfit))})
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {products.length > visibleCount ? (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, products.length - visibleCount)} more (
              {products.length - visibleCount} left)
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
