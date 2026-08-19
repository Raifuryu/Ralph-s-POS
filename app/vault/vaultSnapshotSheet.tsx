"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  formatDateTime,
  formatPeso,
  friendlyDayLabel,
  storeDateFromKey,
} from "@/lib/format";
import { type MoneyAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import IncomeBreakdownCard, { type EServiceFees } from "../incomeBreakdownCard";
import VaultCard from "../vaultCard";
import { recordSnapshot, type VaultSnapshotState } from "./actions";

const initialState: VaultSnapshotState = { error: null };
const HISTORY_PAGE_SIZE = 7;

export type TodaySnapshot = {
  cash_amount: number;
  gcash_amount: number;
  maya_amount: number;
  total_money: number;
  profit: number;
  /** Gross revenue (before cost) for that store-day — null for a row saved
      before this column existed, shown as a real gap rather than a guessed
      0 (see the column's own comment in mariadb/schema.sql). */
  income: number | null;
  updated_at: string;
};

export type SnapshotHistoryEntry = {
  /** Store-day key ("YYYY-MM-DD") — always a day before today (see
      page.tsx's WHERE snapshot_day < CURDATE()); today's own figures are
      shown live via the cards above instead. */
  day: string;
  cash: number;
  gcash: number;
  maya: number;
  totalMoney: number;
  profit: number;
  /** Null for a snapshot recorded before the income column existed — see
      TodaySnapshot's own comment. */
  income: number | null;
};

/** One past snapshot — tap to expand into its cash/gcash/maya breakdown
    (plus their combined total), same "collapsed summary, tap for detail"
    interaction RestockHistorySheet uses for its own receipts. The
    collapsed line leads with income (what came in that day) rather than
    the money-on-hand total — the total is still there, just one tap away,
    since it's a balance rather than a day-specific figure and reads better
    alongside the per-account breakdown than next to profit. */
function SnapshotHistoryRow({ entry }: { entry: SnapshotHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {friendlyDayLabel(storeDateFromKey(entry.day))}
          </span>
          <span className="block text-xs text-muted-foreground">
            {entry.income !== null
              ? `${formatPeso(entry.income)} income · `
              : ""}
            {formatPeso(entry.profit)} profit
          </span>
        </span>
        {expanded ? (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded ? (
        <div className="flex flex-col gap-1 border-t p-3 pt-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Cash</span>
            <span className="tabular-nums">{formatPeso(entry.cash)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">GCash</span>
            <span className="tabular-nums">{formatPeso(entry.gcash)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Maya</span>
            <span className="tabular-nums">{formatPeso(entry.maya)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatPeso(entry.totalMoney)}</span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The whole-vault snapshot: one tap, no typing — captures the 3 account
 * balances exactly as vault_balance already computes them, plus today's
 * profit-so-far, as a single row for today (see recordSnapshot — tapping
 * again the same day just overwrites it, so there's only ever one snapshot
 * per day and the latest tap always prevails). The preview reuses the exact
 * same Money on hand / Income cards the Sales dashboard shows (VaultCard +
 * IncomeBreakdownCard) — this IS that same pair, just always scoped to
 * today and shown a tap away instead of at the top of the page. Below that,
 * every earlier day's saved snapshot is browsable (History). URL-driven
 * (?snapshot) like the other Vault/Inventory sheets.
 */
export default function VaultSnapshotSheet({
  open,
  today,
  currentBalances,
  todayStoreGross,
  todayStoreMargin,
  todayEServiceFees,
  history,
}: {
  open: boolean;
  today: TodaySnapshot | null;
  currentBalances: Map<MoneyAccount, number>;
  todayStoreGross: number;
  todayStoreMargin: number;
  todayEServiceFees: EServiceFees;
  history: SnapshotHistoryEntry[];
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

  const [state, formAction, isPending] = useActionState(
    recordSnapshot,
    initialState
  );

  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  // Client-side, over the already-fetched (bounded) history — same From/To
  // range pattern PersonalTakesSheet's own date filter uses: no server
  // round trip needed for a list this size.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const dateFilterActive = fromDate !== "" || toDate !== "";
  const filteredHistory = history.filter((entry) => {
    if (fromDate && entry.day < fromDate) return false;
    if (toDate && entry.day > toDate) return false;
    return true;
  });

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
          <DrawerTitle>Vault snapshot</DrawerTitle>
          <DrawerDescription>
            {today
              ? `Already recorded today (last updated ${formatDateTime(today.updated_at)}) — recording again replaces it with the current figures below.`
              : "Saves the figures below as today's snapshot — one per day, the latest tap always prevails."}
          </DrawerDescription>
        </DrawerHeader>

        {/* Scrollable: cards + history. The record/close footer stays
            outside this, pinned at the bottom of the sheet, so it's always
            reachable even once the history list grows past one page — same
            "action stays put, list scrolls under it" split BulkRestockSheet
            uses for its own quick-amount chips. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <VaultCard balances={currentBalances} compact />
            <IncomeBreakdownCard
              title="Today's income"
              store={todayStoreGross}
              storeProfit={todayStoreMargin}
              eService={todayEServiceFees}
              showIncomeRow
              compact
            />
          </div>

          {state.error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.result ? (
            <p role="status" className="mt-3 text-sm text-success">
              Snapshot saved.
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              History
            </p>

            {history.length > 0 ? (
              <div className="flex items-end gap-2">
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="snapshot-history-from" className="text-xs">
                      From
                    </Label>
                    <Input
                      id="snapshot-history-from"
                      type="date"
                      value={fromDate}
                      max={toDate || undefined}
                      onChange={(event) => {
                        setFromDate(event.target.value);
                        setVisibleCount(HISTORY_PAGE_SIZE);
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="snapshot-history-to" className="text-xs">
                      To
                    </Label>
                    <Input
                      id="snapshot-history-to"
                      type="date"
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={(event) => {
                        setToDate(event.target.value);
                        setVisibleCount(HISTORY_PAGE_SIZE);
                      }}
                    />
                  </div>
                </div>
                {dateFilterActive ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFromDate("");
                      setToDate("");
                      setVisibleCount(HISTORY_PAGE_SIZE);
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            ) : null}

            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No past snapshots recorded yet — the first tap of &ldquo;Record
                snapshot&rdquo; starts the history.
              </p>
            ) : filteredHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No snapshots match this date range.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {filteredHistory.slice(0, visibleCount).map((entry) => (
                  <SnapshotHistoryRow key={entry.day} entry={entry} />
                ))}
              </ul>
            )}
            {filteredHistory.length > visibleCount ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setVisibleCount((prev) => prev + HISTORY_PAGE_SIZE)}
              >
                Show{" "}
                {Math.min(HISTORY_PAGE_SIZE, filteredHistory.length - visibleCount)}{" "}
                more ({filteredHistory.length - visibleCount} left)
              </Button>
            ) : null}
          </div>
        </div>

        <form action={formAction}>
          <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <DrawerClose
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Close
            </DrawerClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending
                ? "Recording…"
                : today
                  ? "Update snapshot"
                  : "Record snapshot"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
