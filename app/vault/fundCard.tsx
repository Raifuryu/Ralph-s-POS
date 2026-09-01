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
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  adjustFund,
  cashInFund,
  cashOutFund,
  transferFund,
  type FundAdjustState,
  type TransferFundState,
  type VaultMoveState,
} from "./actions";

const initialMoveState: VaultMoveState = { error: null };
const initialAdjustState: FundAdjustState = { error: null };
const initialTransferState: TransferFundState = { error: null };
const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

/** Fund travels as a hidden field — the card that opened this sheet already
    fixed it, so there's nothing left to pick. Same shape as AccountSheet's
    own CashOutForm, just tagged with `fund` instead of `account`. */
function CashOutForm({
  fund,
  onRecorded,
}: {
  fund: ProfitFund;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    cashOutFund,
    initialMoveState
  );

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
      <input type="hidden" name="fund" value={fund} />
      <p className="text-xs text-muted-foreground">
        Spends straight from this fund — no transfer needed first (e.g.
        paying a supplier directly).
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fund-out-amount" className="text-xs">
          Amount
        </Label>
        <Input
          id="fund-out-amount"
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
        <Label htmlFor="fund-out-note" className="text-xs">
          What for?
        </Label>
        <Input
          id="fund-out-note"
          name="note"
          required
          placeholder="e.g. Paid supplier directly"
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
  fund,
  onRecorded,
}: {
  fund: ProfitFund;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    cashInFund,
    initialMoveState
  );

  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.ok, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="fund" value={fund} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="fund-in-amount" className="text-xs">
          Amount
        </Label>
        <Input
          id="fund-in-amount"
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
        <Label htmlFor="fund-in-note" className="text-xs">
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="fund-in-note" name="note" placeholder="e.g. Balance correction" />
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

/** Corrects this fund's balance to whatever it's supposed to actually be —
    the mirror of AccountSheet's own AdjustForm, targeting adjustFund. */
function AdjustForm({
  fund,
  balance,
  onRecorded,
}: {
  fund: ProfitFund;
  balance: number;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    adjustFund,
    initialAdjustState
  );

  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(onRecorded, 1600);
    return () => clearTimeout(timer);
  }, [state.result, onRecorded]);

  const delta = state.result?.delta ?? null;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="fund" value={fund} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="fund-adjust-balance" className="text-xs">
          Correct balance
        </Label>
        <Input
          id="fund-adjust-balance"
          name="target_balance"
          type="number"
          step="0.01"
          min="0"
          required
          inputMode="decimal"
          placeholder={formatPeso(balance)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fund-adjust-note" className="text-xs">
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="fund-adjust-note"
          name="note"
          placeholder="e.g. Miscount corrected"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Currently {formatPeso(balance)} for {PROFIT_FUND_LABELS[fund]} — enter
        what it should actually be and the difference gets logged
        automatically.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.result ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-muted-foreground">
            Was {formatPeso(state.result.previousBalance)} · now{" "}
            {formatPeso(state.result.targetBalance)}
          </p>
          <p
            className={cn(
              "font-medium",
              delta! > 0 ? "text-success" : "text-destructive"
            )}
          >
            Adjusted {delta! > 0 ? "+" : "−"}
            {formatPeso(Math.abs(delta!))}.
          </p>
        </div>
      ) : null}
      <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
        <DrawerClose
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Cancel
        </DrawerClose>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Recording…" : "Save adjustment"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

/** Moves money out of this fund into one or more physical accounts — the
    original (and still primary) reason to open this sheet, see
    transferFund's own doc comment for why it's the only way this money
    ever becomes physically spendable. Pre-filled from `breakdown` — where
    this fund's money originally came from — but every amount stays freely
    editable. */
function TransferForm({
  fund,
  balance,
  breakdown,
  onRecorded,
}: {
  fund: ProfitFund;
  balance: number;
  breakdown: Map<MoneyAccount, number>;
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    transferFund,
    initialTransferState
  );
  const [splits, setSplits] = useState<Record<MoneyAccount, string>>({
    cash: breakdown.get("cash") ? String(breakdown.get("cash")) : "",
    gcash: breakdown.get("gcash") ? String(breakdown.get("gcash")) : "",
    maya: breakdown.get("maya") ? String(breakdown.get("maya")) : "",
  });
  const total = ACCOUNTS.reduce(
    (sum, account) => sum + (Number(splits[account]) || 0),
    0
  );

  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(onRecorded, 1600);
    return () => clearTimeout(timer);
  }, [state.result, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="fund" value={fund} />
      <p className="text-xs text-muted-foreground">
        Pre-filled with where this money originally came from — edit any
        amount, or split it however you like.
      </p>
      {ACCOUNTS.map((account) => (
        <div key={account} className="flex flex-col gap-1">
          <Label htmlFor={`split-${fund}-${account}`} className="text-xs">
            {MONEY_ACCOUNT_LABELS[account]}
          </Label>
          <Input
            id={`split-${fund}-${account}`}
            name={`split_${account}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            value={splits[account]}
            onChange={(event) =>
              setSplits((prev) => ({ ...prev, [account]: event.target.value }))
            }
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Total:{" "}
        <span className="font-medium text-foreground">
          {formatPeso(total)}
        </span>
        {total > balance ? (
          <span className="text-destructive">
            {" "}
            — more than what&rsquo;s available
          </span>
        ) : null}
      </p>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.result ? (
        <p role="status" className="text-sm text-success">
          Transferred {formatPeso(state.result.transferred)} —{" "}
          {formatPeso(state.result.remainingBalance)} left in{" "}
          {PROFIT_FUND_LABELS[fund]}.
        </p>
      ) : null}

      <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
        <DrawerClose
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Cancel
        </DrawerClose>
        <Button
          type="submit"
          size="sm"
          disabled={isPending || total <= 0 || total > balance}
        >
          {isPending ? "Transferring…" : "Transfer"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

/**
 * One Vault fund's card — same Cash out/Cash in/Adjust/Transfer tab set
 * AccountSheet's own account cards use. Transfer is still the main reason
 * to open this (moving money into Cash/GCash/Maya, the only way it becomes
 * physically spendable — see transferFund's own doc comment), so it's the
 * default tab even though it's listed last for consistency with
 * AccountSheet's tab order. Cash out/Cash in/Adjust act straight on this
 * fund's own balance, no transfer involved.
 */
export default function FundCard({
  fund,
  balance,
  breakdown,
}: {
  fund: ProfitFund;
  balance: number;
  breakdown: Map<MoneyAccount, number>;
}) {
  const label = PROFIT_FUND_LABELS[fund];
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
          <DrawerDescription>{formatPeso(balance)} available</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Tabs defaultValue="transfer" className="min-h-0 w-full min-w-0 flex-1">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="out">Cash out</TabsTrigger>
              <TabsTrigger value="in">Cash in</TabsTrigger>
              <TabsTrigger value="adjust">Adjust</TabsTrigger>
              <TabsTrigger value="transfer">Transfer</TabsTrigger>
            </TabsList>
            <TabsContent value="out" className="flex min-h-0 flex-col pt-3">
              <CashOutForm fund={fund} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="in" className="flex min-h-0 flex-col pt-3">
              <CashInForm fund={fund} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="adjust" className="flex min-h-0 flex-col pt-3">
              <AdjustForm
                fund={fund}
                balance={balance}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
            <TabsContent value="transfer" className="flex min-h-0 flex-col pt-3">
              <TransferForm
                fund={fund}
                balance={balance}
                breakdown={breakdown}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
