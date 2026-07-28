"use client";

import { useState } from "react";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
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
};

/** Self-contained card (own border/title), matching MoneyBreakdownCard's
    recipe so every section on the statistics page reads the same. Reused
    for both "Top-selling products" (already curated to 10 by the caller,
    so the "show more" button below never has anything to reveal) and the
    e-service breakdown (uncurated — every service/variant sold in the
    window, which can genuinely run past one page for a store with many
    load/Xerox variants). */
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
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
