"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatDateTime, formatPeso } from "@/lib/format";

const PAGE_SIZE = 20;

export type RestockReceiptLine = {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  cost: number;
  note: string | null;
  created_at: string;
};

export type RestockReceipt = {
  /** First line's id — stable and unique per receipt without a real batch
      id in the schema (see the grouping comment in page.tsx). */
  key: string;
  createdAt: string;
  cashierId: string;
  lines: (RestockReceiptLine & { cashier_id: string })[];
  /** Sum of every line's cost — the total actually spent on this receipt. */
  totalCost: number;
  totalUnits: number;
};

/**
 * Every bulk restock ever submitted, newest first, grouped back into
 * "receipts" (see page.tsx's groupIntoReceipts) — tap one open to see
 * exactly what was on it: each item, how many, and what it cost per piece
 * *at that time* (product_restocks.cost is a historical snapshot, distinct
 * from the product's current cost, which later restocks may have changed).
 * URL-driven (?restocks) like the other Inventory sheets.
 */
export default function RestockHistorySheet({
  open,
  receipts,
}: {
  open: boolean;
  receipts: RestockReceipt[];
}) {
  const router = useRouter();

  // Local, not driven purely by the `open` prop — see ProductSheet/
  // HistorySheet for why: a swipe-to-close needs to animate away instantly
  // rather than waiting on this URL-driven prop's server round trip.
  const [openState, setOpenState] = useState({ prop: open, value: open });
  if (openState.prop !== open) {
    setOpenState({ prop: open, value: open });
  }
  const drawerOpen = openState.value;

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(next) => {
        setOpenState({ prop: open, value: next });
        if (!next) router.push("/inventory", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Restock history</DrawerTitle>
          <DrawerDescription>
            Every restock submitted, newest first. Tap one to see what was on
            it — each item, how many, and what it cost per piece at the
            time.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {receipts.length === 0 ? (
            <EmptyState title="No restocks recorded yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {receipts.slice(0, visibleCount).map((receipt) => {
                const expanded = expandedKey === receipt.key;
                return (
                  <li key={receipt.key} className="rounded-lg border">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedKey(expanded ? null : receipt.key)
                      }
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between gap-2 p-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {formatDateTime(receipt.createdAt)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {receipt.lines.length} item
                          {receipt.lines.length === 1 ? "" : "s"} ·{" "}
                          {receipt.totalUnits} pc
                          {receipt.totalUnits === 1 ? "" : "s"} ·{" "}
                          {formatPeso(receipt.totalCost)}
                        </span>
                      </span>
                      {expanded ? (
                        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>

                    {expanded ? (
                      <ul className="flex flex-col gap-2 border-t p-3 pt-2">
                        {receipt.lines.map((line) => {
                          const unitCost = Number(line.cost) / line.quantity;
                          return (
                            <li
                              key={line.id}
                              className="flex items-baseline justify-between gap-2 text-xs"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {line.product_id ? (
                                  <Link
                                    href={`/inventory?history=${line.product_id}`}
                                    className="font-medium underline-offset-2 hover:underline"
                                  >
                                    {line.product_name}
                                  </Link>
                                ) : (
                                  <span className="font-medium">
                                    {line.product_name}
                                  </span>
                                )}
                                <span className="block text-muted-foreground">
                                  {line.quantity} pc
                                  {line.quantity === 1 ? "" : "s"} ×{" "}
                                  {formatPeso(unitCost)}/pc
                                  {line.note ? ` · ${line.note}` : ""}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {formatPeso(Number(line.cost))}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {receipts.length > visibleCount ? (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() =>
                setVisibleCount((prev) => prev + PAGE_SIZE)
              }
            >
              Show {Math.min(PAGE_SIZE, receipts.length - visibleCount)} more
              ({receipts.length - visibleCount} left)
            </Button>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
