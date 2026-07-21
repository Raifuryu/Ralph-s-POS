"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import { cashIn, cashOut, type VaultMoveState } from "./actions";

const initialState: VaultMoveState = { error: null };

/** Account travels as a hidden field — the card that opened this sheet
    already fixed it, so there's nothing left to pick. */
function CashOutForm({ account }: { account: MoneyAccount }) {
  const [state, formAction, isPending] = useActionState(cashOut, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="account" value={account} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-amount">Amount</Label>
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
        <Label htmlFor="out-note">What for?</Label>
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
      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending ? "Recording…" : "Take cash out"}
      </Button>
    </form>
  );
}

function CashInForm({ account }: { account: MoneyAccount }) {
  const [state, formAction, isPending] = useActionState(cashIn, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="account" value={account} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="in-amount">Amount</Label>
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
        <Label htmlFor="in-note">
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
      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending ? "Recording…" : "Add cash in"}
      </Button>
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

  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger className="block w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/30">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatPeso(balance)}
        </p>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{label}</DrawerTitle>
          <DrawerDescription>{formatPeso(balance)} on hand</DrawerDescription>
        </DrawerHeader>

        <div className="p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Tabs defaultValue="out" className="w-full min-w-0">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="out">Cash out</TabsTrigger>
              <TabsTrigger value="in">Cash in</TabsTrigger>
            </TabsList>
            <TabsContent value="out" className="pt-3">
              <CashOutForm account={account} />
            </TabsContent>
            <TabsContent value="in" className="pt-3">
              <CashInForm account={account} />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
