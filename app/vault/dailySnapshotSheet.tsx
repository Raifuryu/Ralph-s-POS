"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatPeso, friendlyDayLabel, storeDateFromKey } from "@/lib/format";

const PAGE_SIZE = 30;

export type DailySnapshot = {
  /** Store-day key ("YYYY-MM-DD"). */
  day: string;
  /** Vault balance (cash + gcash + maya combined) as of the last vault
      movement on this day — carried forward from the previous snapshot on
      a day with no movement at all. */
  totalMoney: number;
  /** Store margin + e-service fees earned ON this day specifically (not
      cumulative) — same definition as the Profit card above, just per day
      instead of over the whole filtered range. */
  profit: number;
};

/**
 * One row per day that had any vault activity or profit, newest first —
 * "what did the vault look like at the end of each day." Total money is a
 * running balance (see buildDailySnapshots in page.tsx), so it tells the
 * trend over time; profit is that day's own contribution, not cumulative.
 * URL-driven (?snapshot) like the other Vault/Inventory sheets.
 */
export default function DailySnapshotSheet({
  open,
  snapshots,
}: {
  open: boolean;
  snapshots: DailySnapshot[];
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

  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(next) => {
        setOpenState({ prop: open, value: next });
        if (!next) router.push("/vault", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Daily snapshot</DrawerTitle>
          <DrawerDescription>
            Total on hand at the end of each day, and how much was made that
            day — newest first.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {snapshots.length === 0 ? (
            <EmptyState title="No activity recorded yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {snapshots.slice(0, visibleCount).map((snap) => (
                <li
                  key={snap.day}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <span className="text-sm font-medium">
                    {friendlyDayLabel(storeDateFromKey(snap.day))}
                  </span>
                  <span className="flex flex-col items-end text-right">
                    <span className="text-sm tabular-nums">
                      {formatPeso(snap.totalMoney)}
                    </span>
                    <span
                      className={`text-xs tabular-nums ${
                        snap.profit < 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {snap.profit >= 0 ? "+" : ""}
                      {formatPeso(snap.profit)} profit
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {snapshots.length > visibleCount ? (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, snapshots.length - visibleCount)} more
              ({snapshots.length - visibleCount} left)
            </Button>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
