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
import { formatPeso } from "@/lib/format";
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { transferFund, type TransferFundState } from "./actions";

const initialState: TransferFundState = { error: null };
const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

/**
 * One Vault fund's card — tap it to transfer some (or all) of its balance
 * into Cash/GCash/Maya, the only way that money ever becomes physically
 * spendable (see transferFund's own doc comment). The split form starts
 * pre-filled with `breakdown` — that fund's balance broken down by which
 * payment method it originally came from, the natural "send it back where
 * it came from" default — but every amount is freely editable, including
 * splitting across accounts the fund never actually touched (e.g. topping
 * off Cash once Reinvest alone falls short for a restock).
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
  const [state, formAction, isPending] = useActionState(
    transferFund,
    initialState
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

  // Brief delay so the result is actually readable before the sheet closes
  // — same pattern AccountSheet's own forms already use.
  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(() => setOpen(false), 1600);
    return () => clearTimeout(timer);
  }, [state.result]);

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
          <DrawerDescription>
            {formatPeso(balance)} available — transfer some of it into Cash,
            GCash, or Maya to actually spend it.
          </DrawerDescription>
        </DrawerHeader>

        <form
          action={formAction}
          className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
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
              {formatPeso(state.result.remainingBalance)} left in {label}.
            </p>
          ) : null}

          <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
            <DrawerClose
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Close
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
      </DrawerContent>
    </Drawer>
  );
}
