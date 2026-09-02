"use client";

import { useState } from "react";
import { TableIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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

const PAGE_SIZE = 30;

export type DailyProfitRow = {
  key: string;
  label: string;
  /** Store margin + e-service fee for this day — matches the chart's own
      stacked total (STORE_COLOR + ESERVICE_COLOR), not the same figure as
      the vault's 'profit' fund balance, which nets in withdrawals/transfers
      too. */
  profit: number;
  /** Cost recovered on known-cost lines that day — the reinvest side of the
      per-sale fund split (see checkout.ts's own reinvestPortion), same
      "known-cost lines only" rule the profit figure above follows. */
  forRestock: number;
};

/**
 * A day-by-day table for the Profit trend chart above — every day the chart
 * folds into a wider bar past MAX_BARS (long ranges) still gets its own row
 * here, newest first, since a scrollable table isn't limited to the chart's
 * fixed bar width. Self-contained (own trigger + Drawer), same recipe as
 * AccountSheet/FundCard's uncontrolled sheets — this is a read-only view of
 * data the page already computed, no deep link needed.
 */
export default function ProfitTrendTableSheet({
  rows,
}: {
  rows: DailyProfitRow[];
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Always summed over every row, not just the ones "show more" has
  // revealed — same reasoning TopProductsTable's own Total row follows.
  const totalProfit = rows.reduce((sum, r) => sum + r.profit, 0);
  const totalForRestock = rows.reduce((sum, r) => sum + r.forRestock, 0);
  const visibleRows = rows.slice(0, visibleCount);

  return (
    <Drawer>
      <DrawerTrigger
        className="-mr-2 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
        aria-label="View profit and For Restock as a daily table"
      >
        <TableIcon className="size-3.5" />
        Table
      </DrawerTrigger>
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Profit &amp; For Restock, by day</DrawerTitle>
          <DrawerDescription>
            Every day with a sale or service in this window, newest first.
            Profit is store margin plus e-service fees; For Restock is the
            cost recovered on known-cost lines — the same split the
            vault&rsquo;s Profit/For Restock funds post at sale time.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {rows.length === 0 ? (
            <EmptyState title="No profit in this window yet." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">For Restock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPeso(row.profit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPeso(row.forRestock)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPeso(totalProfit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPeso(totalForRestock)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              {rows.length > visibleCount ? (
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, rows.length - visibleCount)} more (
                  {rows.length - visibleCount} left)
                </Button>
              ) : null}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
