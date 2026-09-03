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
  type Wallet,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  adjustWallet,
  cashInWallet,
  cashOutWallet,
  renameWalletAction,
  setWalletActiveAction,
  transferIntoWallet,
  transferWalletOut,
  type RenameWalletState,
  type TransferIntoWalletState,
  type TransferWalletState,
  type VaultMoveState,
  type WalletAdjustState,
} from "./actions";

/** Only what this card (and its Manage tab) actually needs — lets the page
    build this straight from the wallet_balance view (id/name/color/
    is_active/balance in one row) without a second query against the
    wallets table itself for created_by/created_at, which nothing here
    reads. */
export type WalletCardData = Pick<Wallet, "id" | "name" | "color" | "is_active">;

const initialMoveState: VaultMoveState = { error: null };
const initialAdjustState: WalletAdjustState = { error: null };
const initialTransferState: TransferWalletState = { error: null };
const initialTransferInState: TransferIntoWalletState = { error: null };
const initialRenameState: RenameWalletState = { error: null };
const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

/** Wallet id travels as a hidden field — same shape as FundCard's own
    CashOutForm, just tagged with `wallet_id` instead of `fund`. */
function CashOutForm({
  walletId,
  onRecorded,
}: {
  walletId: string;
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    cashOutWallet,
    initialMoveState
  );

  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.ok, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="wallet_id" value={walletId} />
      <p className="text-xs text-muted-foreground">
        Spends straight from this wallet — no transfer needed first.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="wallet-out-amount" className="text-xs">
          Amount
        </Label>
        <Input
          id="wallet-out-amount"
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
        <Label htmlFor="wallet-out-note" className="text-xs">
          What for?
        </Label>
        <Input
          id="wallet-out-note"
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
  walletId,
  onRecorded,
}: {
  walletId: string;
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    cashInWallet,
    initialMoveState
  );

  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.ok, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="wallet_id" value={walletId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="wallet-in-amount" className="text-xs">
          Amount
        </Label>
        <Input
          id="wallet-in-amount"
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
        <Label htmlFor="wallet-in-note" className="text-xs">
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="wallet-in-note" name="note" placeholder="e.g. Balance correction" />
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

/** Corrects this wallet's balance to whatever it's supposed to actually be
    — the mirror of AccountSheet/FundCard's own AdjustForm, targeting
    adjustWallet. */
function AdjustForm({
  walletId,
  walletName,
  balance,
  onRecorded,
}: {
  walletId: string;
  walletName: string;
  balance: number;
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    adjustWallet,
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
      <input type="hidden" name="wallet_id" value={walletId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="wallet-adjust-balance" className="text-xs">
          Correct balance
        </Label>
        <Input
          id="wallet-adjust-balance"
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
        <Label htmlFor="wallet-adjust-note" className="text-xs">
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="wallet-adjust-note"
          name="note"
          placeholder="e.g. Miscount corrected"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Currently {formatPeso(balance)} for {walletName} — enter what it
        should actually be and the difference gets logged automatically.
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

/** Moves money out of this wallet into one or more physical accounts,
    Profit/For Restock, and/or other wallets — the exact mirror of
    FundCard's own TransferForm (for the account fields) plus AccountSheet's
    TransferInForm (for the fund fields), plus every other active wallet.
    All target one action (transferWalletOut); destination wallets ride
    along as a `dest_wallet_splits` JSON field (see the action's own
    comment on why — a wallet's id can't get a fixed `split_<id>` field
    name the way the fixed accounts/funds above do). No natural "where it
    came from" default to pre-fill (a wallet, unlike Profit/For Restock, is
    never auto-funded by a sale) — every split field starts blank. */
function TransferForm({
  walletId,
  balance,
  otherWallets,
  onRecorded,
}: {
  walletId: string;
  balance: number;
  /** Every other ACTIVE wallet — see WalletFilter's own comment on why an
      archived one drops out of pickers like this. */
  otherWallets: WalletCardData[];
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    transferWalletOut,
    initialTransferState
  );
  const [splits, setSplits] = useState<Record<MoneyAccount, string>>({
    cash: "",
    gcash: "",
    maya: "",
  });
  const [fundSplits, setFundSplits] = useState<Record<ProfitFund, string>>({
    profit: "",
    reinvest: "",
  });
  const [walletSplits, setWalletSplits] = useState<Record<string, string>>({});
  const total =
    ACCOUNTS.reduce((sum, account) => sum + (Number(splits[account]) || 0), 0) +
    PROFIT_FUNDS.reduce((sum, fund) => sum + (Number(fundSplits[fund]) || 0), 0) +
    otherWallets.reduce(
      (sum, wallet) => sum + (Number(walletSplits[wallet.id]) || 0),
      0
    );

  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(onRecorded, 1600);
    return () => clearTimeout(timer);
  }, [state.result, onRecorded]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3">
      <input type="hidden" name="wallet_id" value={walletId} />
      <input
        type="hidden"
        name="dest_wallet_splits"
        value={JSON.stringify(
          otherWallets
            .filter((wallet) => (Number(walletSplits[wallet.id]) || 0) > 0)
            .map((wallet) => ({ walletId: wallet.id, amount: walletSplits[wallet.id] }))
        )}
      />
      <p className="text-xs text-muted-foreground">
        Split this wallet&rsquo;s money across Cash/GCash/Maya, Profit/For
        Restock, and/or another wallet however it actually arrived.
      </p>
      {ACCOUNTS.map((account) => (
        <div key={account} className="flex flex-col gap-1">
          <Label htmlFor={`wallet-split-${account}`} className="text-xs">
            {MONEY_ACCOUNT_LABELS[account]}
          </Label>
          <Input
            id={`wallet-split-${account}`}
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
      {PROFIT_FUNDS.map((fund) => (
        <div key={fund} className="flex flex-col gap-1">
          <Label htmlFor={`wallet-split-${fund}`} className="text-xs">
            {PROFIT_FUND_LABELS[fund]}
          </Label>
          <Input
            id={`wallet-split-${fund}`}
            name={`split_${fund}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            value={fundSplits[fund]}
            onChange={(event) =>
              setFundSplits((prev) => ({ ...prev, [fund]: event.target.value }))
            }
          />
        </div>
      ))}
      {otherWallets.map((wallet) => (
        <div key={wallet.id} className="flex flex-col gap-1">
          <Label htmlFor={`wallet-split-w-${wallet.id}`} className="text-xs">
            {wallet.name}
          </Label>
          <Input
            id={`wallet-split-w-${wallet.id}`}
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
          {formatPeso(state.result.remainingBalance)} left.
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

/** Pulls money into this wallet from one or more physical accounts — the
    last missing account/fund/wallet direction (see transferAccountsToWallet's
    own doc comment), same "pull in" shape as AccountSheet's own
    TransferInForm but simpler (accounts only — a wallet pulling from a fund
    isn't a thing, and pulling from another wallet is already covered by
    that other wallet's own Transfer out tab). */
function TransferInForm({
  walletId,
  accountBalances,
  onRecorded,
}: {
  walletId: string;
  accountBalances: Map<MoneyAccount, number>;
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    transferIntoWallet,
    initialTransferInState
  );
  const [splits, setSplits] = useState<Record<MoneyAccount, string>>({
    cash: "",
    gcash: "",
    maya: "",
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
      <input type="hidden" name="wallet_id" value={walletId} />
      <p className="text-xs text-muted-foreground">
        Pull money from Cash/GCash/Maya into this wallet.
      </p>
      {ACCOUNTS.map((account) => (
        <div key={account} className="flex flex-col gap-1">
          <Label htmlFor={`wallet-transfer-in-${account}`} className="text-xs">
            {MONEY_ACCOUNT_LABELS[account]}{" "}
            <span className="font-normal text-muted-foreground">
              ({formatPeso(accountBalances.get(account) ?? 0)} available)
            </span>
          </Label>
          <Input
            id={`wallet-transfer-in-${account}`}
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
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.result ? (
        <p role="status" className="text-sm text-success">
          Transferred {formatPeso(state.result.transferred)} into this wallet.
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

/** Rename + archive/unarchive — the only two things about a wallet itself
    (not its balance) the owner can change after creating it. Kept as its
    own tab rather than a header icon so it fits the same
    useActionState/DrawerFooter shape every other tab here already uses. */
function ManageForm({
  wallet,
  onRenamed,
}: {
  wallet: WalletCardData;
  /** Called after a successful rename with the new name — the header title
      elsewhere in this card is only known to the parent (see WalletCard's
      own `name` state), so the rename has to be reported back up rather
      than closing the sheet outright (unlike every other tab here, staying
      open after a rename is more useful — the owner's still looking at
      this same wallet). */
  onRenamed: (name: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    renameWalletAction,
    initialRenameState
  );
  const [archiving, setArchiving] = useState(false);
  const [name, setName] = useState(wallet.name);

  useEffect(() => {
    if (state.ok) onRenamed(name);
    // Only fire on a fresh success — `name` itself changes on every
    // keystroke and shouldn't retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  async function handleArchiveToggle() {
    setArchiving(true);
    try {
      await setWalletActiveAction(wallet.id, !wallet.is_active);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="wallet_id" value={wallet.id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="wallet-rename" className="text-xs">
            Name
          </Label>
          <Input
            id="wallet-rename"
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="text-sm text-success">
            Renamed.
          </p>
        ) : null}
        <Button
          type="submit"
          size="sm"
          className="self-start"
          disabled={isPending || name.trim() === wallet.name}
        >
          {isPending ? "Saving…" : "Save name"}
        </Button>
      </form>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {wallet.is_active
            ? "Archiving drops this wallet from the transfer/restock pickers — its balance and history stay intact."
            : "This wallet is archived — it's hidden from the transfer/restock pickers. Unarchive to use it again."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={archiving}
          onClick={handleArchiveToggle}
        >
          {archiving
            ? "Saving…"
            : wallet.is_active
              ? "Archive this wallet"
              : "Unarchive this wallet"}
        </Button>
      </div>
    </div>
  );
}

/**
 * One owner-created wallet's card — same Cash out/Cash in/Adjust/Transfer/
 * Manage tab set FundCard's own funds use, minus a "today" figure (a
 * wallet, unlike Profit/For Restock, is never auto-funded by a sale — see
 * WalletCard's own TransferForm comment). Transfer is still the default
 * tab, same reasoning FundCard's own default follows.
 */
export default function WalletCard({
  wallet,
  balance,
  otherWallets,
  accountBalances,
}: {
  wallet: WalletCardData;
  balance: number;
  /** Every other ACTIVE wallet — passed through to this card's own
      TransferForm (see its own comment). Already excludes `wallet` itself
      — the caller builds this per-card. */
  otherWallets: WalletCardData[];
  /** Every account's own balance — passed through to this card's own
      TransferInForm. */
  accountBalances: Map<MoneyAccount, number>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(wallet.name);

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      <DrawerTrigger className="block w-full min-w-0 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/30">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: wallet.color }}
          />
          <span className="truncate">{name}</span>
        </p>
        <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">
          {formatPeso(balance)}
        </p>
      </DrawerTrigger>

      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>{name}</DrawerTitle>
          <DrawerDescription>{formatPeso(balance)} available</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Tabs defaultValue="transfer-out" className="min-h-0 w-full min-w-0 flex-1">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="out">Cash out</TabsTrigger>
              <TabsTrigger value="in">Cash in</TabsTrigger>
              <TabsTrigger value="adjust">Adjust</TabsTrigger>
              <TabsTrigger value="transfer-out">Transfer out</TabsTrigger>
              <TabsTrigger value="transfer-in">Transfer in</TabsTrigger>
              <TabsTrigger value="manage">Manage</TabsTrigger>
            </TabsList>
            <TabsContent value="out" className="flex min-h-0 flex-col pt-3">
              <CashOutForm walletId={wallet.id} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="in" className="flex min-h-0 flex-col pt-3">
              <CashInForm walletId={wallet.id} onRecorded={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="adjust" className="flex min-h-0 flex-col pt-3">
              <AdjustForm
                walletId={wallet.id}
                walletName={name}
                balance={balance}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
            <TabsContent value="transfer-out" className="flex min-h-0 flex-col pt-3">
              <TransferForm
                walletId={wallet.id}
                balance={balance}
                otherWallets={otherWallets}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
            <TabsContent value="transfer-in" className="flex min-h-0 flex-col pt-3">
              <TransferInForm
                walletId={wallet.id}
                accountBalances={accountBalances}
                onRecorded={() => setOpen(false)}
              />
            </TabsContent>
            <TabsContent value="manage" className="flex min-h-0 flex-col pt-3">
              <ManageForm wallet={wallet} onRenamed={setName} />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
