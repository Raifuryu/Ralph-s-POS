"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/emptyState";
import { FilterChip } from "@/components/filterChip";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatPeso } from "@/lib/format";
import {
  MONEY_ACCOUNTS,
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUNDS,
  PROFIT_FUND_LABELS,
  VAULT_ENTRY_TYPE_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { counterEntry, type CounterEntryState } from "./vault/actions";

const initialCounterState: CounterEntryState = { error: null };

/** Only the 4 entry types this sheet ever shows/filters — cash in/out,
    transfer, adjustment. Sale/service/void/count don't belong here (this
    is Baseline Fund's own manual-activity history, not the full ledger). */
const HISTORY_TYPES = ["deposit", "withdrawal", "transfer", "adjustment"] as const;
type HistoryType = (typeof HISTORY_TYPES)[number];

export type HistoryEntry = {
  id: string;
  entry_type: HistoryType;
  account: MoneyAccount;
  amount: number;
  note: string | null;
  created_at: string;
  /** Only set for deposit/withdrawal rows (see vault_counter_remaining) —
      null for transfer/adjustment, which carry no "outstanding" concept.
      A fully-countered row (remaining <= 0) is dropped by the caller
      before it ever reaches this component — see page.tsx's own query. */
  remaining: number | null;
};

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** The counter form for one Cash In/Cash Out entry — "cash" posts a single
    plain Cash Out/Cash In on the SAME account (opposite of the original,
    so it actually offsets it); "transfer" does the same via a two-leg
    transfer to/from a chosen destination (another account, a wallet, or a
    fund) instead. Which direction ("cash out" vs "cash in", "send to" vs
    "pull from") depends on whether the original was a Cash In or a Cash
    Out — see counterVaultEntry's own doc comment. */
function CounterForm({
  entry,
  wallets,
  onRecorded,
}: {
  entry: HistoryEntry;
  wallets: { id: string; name: string }[];
  onRecorded: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    counterEntry,
    initialCounterState
  );
  const [action, setAction] = useState<"cash" | "transfer">("cash");
  const [destType, setDestType] = useState<"account" | "wallet" | "fund">("account");
  const otherAccounts = MONEY_ACCOUNTS.filter((a) => a !== entry.account);
  const [destAccount, setDestAccount] = useState<MoneyAccount>(otherAccounts[0]);
  const [destWalletId, setDestWalletId] = useState(wallets[0]?.id ?? "");
  const [destFund, setDestFund] = useState<ProfitFund>("profit");

  // Countering a Cash In (money the account gained) moves money back OUT;
  // countering a Cash Out (money the account lost) moves money back IN.
  const isReversal = entry.entry_type === "deposit";
  const cashLabel = isReversal ? "Cash out" : "Cash in";
  const remaining = entry.remaining ?? 0;

  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(onRecorded, 1400);
    return () => clearTimeout(timer);
  }, [state.result, onRecorded]);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-t pt-3"
    >
      <input type="hidden" name="original_id" value={entry.id} />
      <input type="hidden" name="action" value={action} />
      {action === "transfer" ? (
        <>
          <input type="hidden" name="destination_type" value={destType} />
          {destType === "account" ? (
            <input type="hidden" name="destination_account" value={destAccount} />
          ) : null}
          {destType === "wallet" ? (
            <input type="hidden" name="destination_wallet_id" value={destWalletId} />
          ) : null}
          {destType === "fund" ? (
            <input type="hidden" name="destination_fund" value={destFund} />
          ) : null}
        </>
      ) : null}

      <Tabs value={action} onValueChange={(v) => setAction(v as "cash" | "transfer")}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="cash">{cashLabel}</TabsTrigger>
          <TabsTrigger value="transfer">Transfer</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`counter-amount-${entry.id}`} className="text-xs">
          Amount{" "}
          <span className="font-normal text-muted-foreground">
            ({formatPeso(remaining)} remaining)
          </span>
        </Label>
        <Input
          id={`counter-amount-${entry.id}`}
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          max={remaining}
          required
          inputMode="decimal"
          placeholder="0.00"
        />
      </div>

      {action === "transfer" ? (
        <div className="flex flex-col gap-2">
          <Label className="text-xs">
            {isReversal ? "Send to" : "Pull from"}
          </Label>
          <Tabs
            value={destType}
            onValueChange={(v) => setDestType(v as "account" | "wallet" | "fund")}
          >
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="wallet">Wallet</TabsTrigger>
              <TabsTrigger value="fund">Fund</TabsTrigger>
            </TabsList>
          </Tabs>
          {destType === "account" ? (
            <Select
              value={destAccount}
              onChange={(e) => setDestAccount(e.target.value as MoneyAccount)}
            >
              {otherAccounts.map((a) => (
                <option key={a} value={a}>
                  {MONEY_ACCOUNT_LABELS[a]}
                </option>
              ))}
            </Select>
          ) : destType === "wallet" ? (
            wallets.length > 0 ? (
              <Select
                value={destWalletId}
                onChange={(e) => setDestWalletId(e.target.value)}
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No wallets yet.</p>
            )
          ) : (
            <Select
              value={destFund}
              onChange={(e) => setDestFund(e.target.value as ProfitFund)}
            >
              {PROFIT_FUNDS.map((f) => (
                <option key={f} value={f}>
                  {PROFIT_FUND_LABELS[f]}
                </option>
              ))}
            </Select>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`counter-note-${entry.id}`} className="text-xs">
          {action === "cash" && isReversal ? (
            "What for?"
          ) : (
            <>
              Note{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </>
          )}
        </Label>
        <Input
          id={`counter-note-${entry.id}`}
          name="note"
          required={action === "cash" && isReversal}
          placeholder={
            action === "cash" && isReversal ? "e.g. Paid supplier directly" : undefined
          }
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.result ? (
        <p role="status" className="text-sm text-success">
          Recorded — {formatPeso(state.result.remaining)} remaining.
        </p>
      ) : null}

      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={isPending || (destType === "wallet" && wallets.length === 0)}
      >
        {isPending ? "Recording…" : "Record"}
      </Button>
    </form>
  );
}

function HistoryCard({
  entry,
  expanded,
  onToggle,
  wallets,
}: {
  entry: HistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  wallets: { id: string; name: string }[];
}) {
  const counterable = entry.entry_type === "deposit" || entry.entry_type === "withdrawal";
  const amount = Number(entry.amount);

  return (
    <div className="rounded-lg border bg-card p-3">
      <button
        type="button"
        onClick={counterable ? onToggle : undefined}
        className={cn(
          "flex w-full items-start justify-between gap-2 text-left",
          !counterable && "cursor-default"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {VAULT_ENTRY_TYPE_LABELS[entry.entry_type]} ·{" "}
            {MONEY_ACCOUNT_LABELS[entry.account]}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {entry.note || "—"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {formatDateTime(entry.created_at)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={cn(
              "font-medium tabular-nums",
              amount < 0 && "text-destructive"
            )}
          >
            {amount > 0 ? "+" : "−"}
            {formatPeso(Math.abs(amount))}
          </span>
          {counterable && entry.remaining !== Math.abs(amount) ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatPeso(entry.remaining ?? 0)} remaining
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <CounterForm entry={entry} wallets={wallets} onRecorded={onToggle} />
      ) : null}
    </div>
  );
}

/**
 * Baseline Fund's own "History" button opens this — a filtered view of just
 * the manual/administrative activity on Cash/GCash/Maya (cash in/out,
 * transfer, adjustment; NOT sale/service/void/count, which belong to the
 * full Vault ledger instead). Tapping a Cash In/Cash Out card opens the
 * counter form (see CounterForm's own comment) — Transfer/Adjustment cards
 * are view-only, no counter concept applies to them. Filters are local UI
 * state (not URL-driven) — this sheet doesn't need to be deep-linkable
 * beyond its own open/closed state.
 */
export default function BaselineFundHistorySheet({
  open,
  entries,
  wallets,
}: {
  open: boolean;
  entries: HistoryEntry[];
  wallets: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [openState, setOpenState] = useState({ prop: open, value: open });
  if (openState.prop !== open) {
    setOpenState({ prop: open, value: open });
  }
  const drawerOpen = openState.value;

  const [accountFilter, setAccountFilter] = useState<Set<MoneyAccount>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<HistoryType>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = entries.filter((entry) => {
    if (accountFilter.size > 0 && !accountFilter.has(entry.account)) return false;
    if (typeFilter.size > 0 && !typeFilter.has(entry.entry_type)) return false;
    return true;
  });

  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(next) => {
        setOpenState({ prop: open, value: next });
        if (!next) router.push("/", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Cash activity</DrawerTitle>
          <DrawerDescription>
            Cash in, cash out, transfers, and adjustments on Cash/GCash/Maya.
            Tap a Cash In/Cash Out to counter it — e.g. cash back out what
            was cashed in.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {MONEY_ACCOUNTS.map((account) => (
                <FilterChip
                  key={account}
                  label={MONEY_ACCOUNT_LABELS[account]}
                  active={accountFilter.has(account)}
                  onClick={() =>
                    setAccountFilter((prev) => toggleInSet(prev, account))
                  }
                />
              ))}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {HISTORY_TYPES.map((type) => (
                <FilterChip
                  key={type}
                  label={VAULT_ENTRY_TYPE_LABELS[type]}
                  active={typeFilter.has(type)}
                  onClick={() => setTypeFilter((prev) => toggleInSet(prev, type))}
                />
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title={
                  entries.length === 0
                    ? "No cash activity yet."
                    : "No entries match this filter."
                }
              />
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {filtered.map((entry) => (
                <HistoryCard
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === entry.id ? null : entry.id))
                  }
                  wallets={wallets}
                />
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
