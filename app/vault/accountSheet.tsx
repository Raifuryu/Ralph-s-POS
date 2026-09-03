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
  PROFIT_FUNDS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  adjustBalance,
  cashIn,
  cashOut,
  transferToAccount,
  type TransferToAccountState,
  type VaultAdjustState,
  type VaultMoveState,
} from "./actions";
import type { WalletCardData } from "./walletCard";

const initialState: VaultMoveState = { error: null };
const initialAdjustState: VaultAdjustState = { error: null };
const initialTransferState: TransferToAccountState = { error: null };

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

/** Corrects this account's balance to whatever it's supposed to actually
    be, instead of asking the cashier to work out the difference themselves
    — they type the correct figure (e.g. "it's 8500"), and the delta from
    the current balance is computed server-side and logged as a single
    'adjustment' entry (see adjustVaultBalance). */
function AdjustForm({
  account,
  balance,
  onRecorded,
}: {
  account: MoneyAccount;
  balance: number;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    adjustBalance,
    initialAdjustState
  );

  // Longer delay than Cash in/out — there's a result to actually read here
  // (the delta that got logged), not just a one-line confirmation.
  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(onRecorded, 1600);
    return () => clearTimeout(timer);
  }, [state.result, onRecorded]);

  const delta = state.result?.delta ?? null;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="account" value={account} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="adjust-balance" className="text-xs">
          Correct balance
        </Label>
        <Input
          id="adjust-balance"
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
        <Label htmlFor="adjust-note" className="text-xs">
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="adjust-note"
          name="note"
          placeholder="e.g. Miscount corrected"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Currently {formatPeso(balance)} for {MONEY_ACCOUNT_LABELS[account]} —
        enter what it should actually be and the difference gets logged
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

/** Pulls money out of Profit/For Restock and/or any active wallet into this
    account — the mirror of FundCard/WalletCard's own transfer forms,
    started from the account's side instead (see transferFundsToAccount's
    own doc comment). No natural "where it came from" default to pre-fill
    here, so every split field starts blank. Wallet splits ride along as a
    `wallet_splits` JSON field — see transferToAccount's own comment on why
    a wallet's dynamic id can't get a fixed `split_<id>` field name the way
    the two funds above do. */
function TransferInForm({
  account,
  fundBalances,
  wallets,
  walletBalances,
  onRecorded,
}: {
  account: MoneyAccount;
  fundBalances: Map<ProfitFund, number>;
  /** Active wallets only — an archived one drops out of this picker (see
      wallets' own comment in mariadb/schema.sql). */
  wallets: WalletCardData[];
  walletBalances: Map<string, number>;
  /** Called shortly after a successful record — the drawer closes itself
      instead of leaving Cancel as the only way out. */
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    transferToAccount,
    initialTransferState
  );
  const [splits, setSplits] = useState<Record<ProfitFund, string>>({
    profit: "",
    reinvest: "",
  });
  const [walletSplits, setWalletSplits] = useState<Record<string, string>>({});
  const fundTotal = PROFIT_FUNDS.reduce(
    (sum, fund) => sum + (Number(splits[fund]) || 0),
    0
  );
  const walletTotal = wallets.reduce(
    (sum, wallet) => sum + (Number(walletSplits[wallet.id]) || 0),
    0
  );
  const total = fundTotal + walletTotal;

  // Longer delay than Cash in/out — there's a result to actually read here,
  // same reasoning AdjustForm's own delay follows.
  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(onRecorded, 1600);
    return () => clearTimeout(timer);
  }, [state.result, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="account" value={account} />
      <input
        type="hidden"
        name="wallet_splits"
        value={JSON.stringify(
          wallets
            .filter((wallet) => (Number(walletSplits[wallet.id]) || 0) > 0)
            .map((wallet) => ({ walletId: wallet.id, amount: walletSplits[wallet.id] }))
        )}
      />
      <p className="text-xs text-muted-foreground">
        Pull money from Profit, For Restock, and/or any wallet into{" "}
        {MONEY_ACCOUNT_LABELS[account]}.
      </p>
      {PROFIT_FUNDS.map((fund) => (
        <div key={fund} className="flex flex-col gap-1">
          <Label htmlFor={`transfer-in-${fund}`} className="text-xs">
            {PROFIT_FUND_LABELS[fund]}{" "}
            <span className="font-normal text-muted-foreground">
              ({formatPeso(fundBalances.get(fund) ?? 0)} available)
            </span>
          </Label>
          <Input
            id={`transfer-in-${fund}`}
            name={`split_${fund}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            value={splits[fund]}
            onChange={(event) =>
              setSplits((prev) => ({ ...prev, [fund]: event.target.value }))
            }
          />
        </div>
      ))}
      {wallets.map((wallet) => (
        <div key={wallet.id} className="flex flex-col gap-1">
          <Label htmlFor={`transfer-in-wallet-${wallet.id}`} className="text-xs">
            {wallet.name}{" "}
            <span className="font-normal text-muted-foreground">
              ({formatPeso(walletBalances.get(wallet.id) ?? 0)} available)
            </span>
          </Label>
          <Input
            id={`transfer-in-wallet-${wallet.id}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            value={walletSplits[wallet.id] ?? ""}
            onChange={(event) =>
              setWalletSplits((prev) => ({ ...prev, [wallet.id]: event.target.value }))
            }
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
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
      {state.result ? (
        <p role="status" className="text-sm text-success">
          Transferred {formatPeso(state.result.transferred)} into{" "}
          {MONEY_ACCOUNT_LABELS[account]}.
        </p>
      ) : null}
      <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
        <DrawerClose
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Cancel
        </DrawerClose>
        <Button type="submit" size="sm" disabled={isPending || total <= 0}>
          {isPending ? "Transferring…" : "Transfer"}
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
  fundBalances,
  wallets,
  walletBalances,
}: {
  account: MoneyAccount;
  balance: number;
  fundBalances: Map<ProfitFund, number>;
  /** Active wallets only — see TransferInForm's own comment. */
  wallets: WalletCardData[];
  walletBalances: Map<string, number>;
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
              <TabsTrigger value="adjust">Adjust</TabsTrigger>
              <TabsTrigger value="transfer">Transfer</TabsTrigger>
            </TabsList>
            <TabsContent value="out" className="flex min-h-0 flex-col pt-3">
              <CashOutForm account={account} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="in" className="flex min-h-0 flex-col pt-3">
              <CashInForm account={account} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="adjust" className="flex min-h-0 flex-col pt-3">
              <AdjustForm
                account={account}
                balance={balance}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
            <TabsContent value="transfer" className="flex min-h-0 flex-col pt-3">
              <TransferInForm
                account={account}
                fundBalances={fundBalances}
                wallets={wallets}
                walletBalances={walletBalances}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
