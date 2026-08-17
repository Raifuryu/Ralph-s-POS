"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

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
import { formatDateTime } from "@/lib/format";
import { type MoneyAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import IncomeBreakdownCard, { type EServiceFees } from "../incomeBreakdownCard";
import VaultCard from "../vaultCard";
import { recordSnapshot, type VaultSnapshotState } from "./actions";

const initialState: VaultSnapshotState = { error: null };

export type TodaySnapshot = {
  cash_amount: number;
  gcash_amount: number;
  maya_amount: number;
  total_money: number;
  profit: number;
  updated_at: string;
};

/**
 * The whole-vault snapshot: one tap, no typing — captures the 3 account
 * balances exactly as vault_balance already computes them, plus today's
 * profit-so-far, as a single row for today (see recordSnapshot — tapping
 * again the same day just overwrites it, so there's only ever one snapshot
 * per day and the latest tap always prevails). The preview reuses the exact
 * same Money on hand / Income cards the Sales dashboard shows (VaultCard +
 * IncomeBreakdownCard) — this IS that same pair, just always scoped to
 * today and shown a tap away instead of at the top of the page. URL-driven
 * (?snapshot) like the other Vault/Inventory sheets.
 */
export default function VaultSnapshotSheet({
  open,
  today,
  currentBalances,
  todayStoreGross,
  todayStoreMargin,
  todayEServiceFees,
}: {
  open: boolean;
  today: TodaySnapshot | null;
  currentBalances: Map<MoneyAccount, number>;
  todayStoreGross: number;
  todayStoreMargin: number;
  todayEServiceFees: EServiceFees;
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <VaultCard balances={currentBalances} compact />
            <IncomeBreakdownCard
              title="Today's income"
              store={todayStoreGross}
              storeProfit={todayStoreMargin}
              eService={todayEServiceFees}
              compact
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.result ? (
            <p role="status" className="text-sm text-success">
              Snapshot saved.
            </p>
          ) : null}

          <form action={formAction} className="mt-auto flex flex-col">
            <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
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
        </div>
      </DrawerContent>
    </Drawer>
  );
}
