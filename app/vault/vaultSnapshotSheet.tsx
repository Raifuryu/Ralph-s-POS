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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime, formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";
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
 * The whole-vault manual snapshot: count all 3 accounts together, submit
 * once, and the server saves the total plus today's profit-so-far as a
 * single row for today (see recordSnapshot — recording again the same day
 * just overwrites it, so there's only ever one snapshot per day and the
 * latest reading always prevails). URL-driven (?snapshot) like the other
 * Vault/Inventory sheets.
 */
export default function VaultSnapshotSheet({
  open,
  today,
}: {
  open: boolean;
  today: TodaySnapshot | null;
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

  // Pre-filled from today's existing snapshot (if any) so re-counting is an
  // edit, not starting from scratch — same "placeholder shows the current
  // figure" idea AdjustForm uses, just as real editable values here since
  // there are 3 of them to combine into one total.
  const [cash, setCash] = useState(today ? String(today.cash_amount) : "");
  const [gcash, setGcash] = useState(today ? String(today.gcash_amount) : "");
  const [maya, setMaya] = useState(today ? String(today.maya_amount) : "");
  const total =
    (Number(cash) || 0) + (Number(gcash) || 0) + (Number(maya) || 0);

  const result = state.result;

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
              ? `Already recorded today (last updated ${formatDateTime(today.updated_at)}) — recording again replaces it.`
              : "Count cash, GCash, and Maya, then record today's snapshot — one per day, the latest always prevails."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <form
            action={formAction}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="snapshot-cash" className="text-xs">
                Cash
              </Label>
              <Input
                id="snapshot-cash"
                name="cash"
                type="number"
                step="0.01"
                min="0"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={cash}
                onChange={(event) => setCash(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="snapshot-gcash" className="text-xs">
                GCash
              </Label>
              <Input
                id="snapshot-gcash"
                name="gcash"
                type="number"
                step="0.01"
                min="0"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={gcash}
                onChange={(event) => setGcash(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="snapshot-maya" className="text-xs">
                Maya
              </Label>
              <Input
                id="snapshot-maya"
                name="maya"
                type="number"
                step="0.01"
                min="0"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={maya}
                onChange={(event) => setMaya(event.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Total:{" "}
              <span className="font-medium text-foreground">
                {formatPeso(total)}
              </span>
            </p>
            {state.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
            {result ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  {formatPeso(result.totalMoney)} total ·{" "}
                  {formatPeso(result.profit)} profit today
                </p>
                <p className="text-xs text-muted-foreground">
                  Cash {formatPeso(result.cash)} · GCash{" "}
                  {formatPeso(result.gcash)} · Maya {formatPeso(result.maya)}
                </p>
              </div>
            ) : null}
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
