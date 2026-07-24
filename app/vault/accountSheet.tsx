"use client";

import { useActionState, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import { cashIn, cashOut, type VaultMoveState } from "./actions";

const initialState: VaultMoveState = { error: null };

/** Account travels as a hidden field — the card that opened this sheet
    already fixed it, so there's nothing left to pick. */
function CashOutForm({
  account,
  onRecorded,
}: {
  account: MoneyAccount;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(cashOut, initialState);

  // Brief delay so "Cash out recorded." is actually readable before the
  // sheet closes — an instant close would make the confirmation flash by
  // unseen.
  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.ok, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="account" value={account} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-amount" className="text-xs">
          Amount
        </Label>
        <Input
          id="out-amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          inputMode="decimal"
          placeholder="0.00"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-note" className="text-xs">
          What for?
        </Label>
        <Input
          id="out-note"
          name="note"
          required
          placeholder="e.g. Bought supplies, owner drawing"
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm">
          Cash out recorded.
        </p>
      ) : null}
      <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
        <DrawerClose
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Cancel
        </DrawerClose>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Recording…" : "Take cash out"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

function CashInForm({
  account,
  onRecorded,
}: {
  account: MoneyAccount;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(cashIn, initialState);

  // Brief delay so "Cash in recorded." is actually readable before the
  // sheet closes — an instant close would make the confirmation flash by
  // unseen.
  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.ok, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="account" value={account} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="in-amount" className="text-xs">
          Amount
        </Label>
        <Input
          id="in-amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          inputMode="decimal"
          placeholder="0.00"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="in-note" className="text-xs">
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="in-note" name="note" placeholder="e.g. Opening float" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm">
          Cash in recorded.
        </p>
      ) : null}
      <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
        <DrawerClose
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Cancel
        </DrawerClose>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Recording…" : "Add cash in"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

/**
 * The account card itself is the drawer trigger — tapping it opens a sheet
 * scoped to that one account, with no account picker needed inside.
 */
export default function AccountSheet({
  account,
  balance,
}: {
  account: MoneyAccount;
  balance: number;
}) {
  const label = MONEY_ACCOUNT_LABELS[account];
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      <DrawerTrigger className="block w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/30">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatPeso(balance)}
        </p>
      </DrawerTrigger>

      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>{label}</DrawerTitle>
          <DrawerDescription>{formatPeso(balance)} on hand</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Tabs
            defaultValue="out"
            className="min-h-0 w-full min-w-0 flex-1"
          >
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="out">Cash out</TabsTrigger>
              <TabsTrigger value="in">Cash in</TabsTrigger>
            </TabsList>
            <TabsContent value="out" className="flex min-h-0 flex-col pt-3">
              <CashOutForm account={account} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="in" className="flex min-h-0 flex-col pt-3">
              <CashInForm account={account} onRecorded={() => setOpen(false)} />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
