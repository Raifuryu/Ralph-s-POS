"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatDateTime, formatPeso, friendlyDayLabel, storeDayKey } from "@/lib/format";

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

type ReceiptDayGroup = {
  key: string;
  label: string;
  receipts: RestockReceipt[];
  totalCost: number;
  totalUnits: number;
};

/** Groups by calendar day in the STORE's timezone — same reasoning
    TransactionTable's own groupByDay follows (grouping by server-local
    dates would split days at 8am Manila once deployed on a UTC host).
    Receipts arrive newest-first (see page.tsx), so groups come out
    newest-first too. */
function groupReceiptsByDay(receipts: RestockReceipt[]): ReceiptDayGroup[] {
  const order: string[] = [];
  const byDay = new Map<string, ReceiptDayGroup>();

  for (const receipt of receipts) {
    const key = storeDayKey(receipt.createdAt);
    let group = byDay.get(key);
    if (!group) {
      group = {
        key,
        label: friendlyDayLabel(receipt.createdAt),
        receipts: [],
        totalCost: 0,
        totalUnits: 0,
      };
      byDay.set(key, group);
      order.push(key);
    }
    group.receipts.push(receipt);
    group.totalCost += receipt.totalCost;
    group.totalUnits += receipt.totalUnits;
  }

  return order.map((key) => byDay.get(key)!);
}

/**
 * Every bulk restock ever submitted, newest first, grouped back into
 * "receipts" (see page.tsx's groupIntoReceipts) — tap one open to see
 * exactly what was on it: each item, how many, and what it cost per piece
 * *at that time* (product_restocks.cost is a historical snapshot, distinct
 * from the product's current cost, which later restocks may have changed).
 * Receipts are further grouped under a day header (same recipe
 * TransactionTable already uses for sales), so several restocks submitted
 * the same day sit under one heading with a combined total instead of
 * scrolling past as unrelated rows. URL-driven (?restocks) like the other
 * Inventory sheets.
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

  // Same "group only what's currently revealed" split TransactionTable
  // uses — "load more" still reveals one more receipt at a time regardless
  // of day boundaries, it just happens to render grouped once revealed.
  const visibleReceipts = receipts.slice(0, visibleCount);
  const dayGroups = groupReceiptsByDay(visibleReceipts);

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
            <div className="flex flex-col gap-3">
              {dayGroups.map((group) => (
                <section
                  key={group.key}
                  className="rounded-lg border bg-card px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2 border-b pb-2 pt-1">
                    <h3 className="text-sm font-semibold">
                      {group.label}{" "}
                      <Badge className="ml-1">
                        {group.receipts.length}{" "}
                        {group.receipts.length === 1 ? "restock" : "restocks"}
                      </Badge>
                    </h3>
                    <span className="flex flex-col items-end">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatPeso(group.totalCost)}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {group.totalUnits} pc{group.totalUnits === 1 ? "" : "s"}
                      </p>
                    </span>
                  </div>

                  <ul className="flex flex-col gap-2 pt-2">
                    {group.receipts.map((receipt) => {
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
                                const unitCost =
                                  Number(line.cost) / line.quantity;
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
                </section>
              ))}
            </div>
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
