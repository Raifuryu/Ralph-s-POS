"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import {
  MONEY_ACCOUNTS,
  MONEY_ACCOUNT_LABELS,
} from "@/lib/types";
import {
  cashIn,
  cashOut,
  recordCount,
  type VaultCountState,
  type VaultMoveState,
} from "./actions";

function AccountSelect({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${idPrefix}-account`}>Account</Label>
      <Select
        id={`${idPrefix}-account`}
        name="account"
        defaultValue="cash"
      >
        {MONEY_ACCOUNTS.map((account) => (
          <option key={account} value={account}>
            {MONEY_ACCOUNT_LABELS[account]}
          </option>
        ))}
      </Select>
    </div>
  );
}

const moveInitial: VaultMoveState = { error: null };
const countInitial: VaultCountState = { error: null };

function CashOutForm() {
  const [state, formAction, isPending] = useActionState(cashOut, moveInitial);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <AccountSelect idPrefix="out" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-amount">Amount</Label>
        <Input id="out-amount" name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" placeholder="0.00" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-note">What for?</Label>
        <Input id="out-note" name="note" required placeholder="e.g. Bought supplies, owner drawing" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm">Cash out recorded.</p>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending ? "Recording…" : "Take cash out"}
      </Button>
    </form>
  );
}

function CashInForm() {
  const [state, formAction, isPending] = useActionState(cashIn, moveInitial);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <AccountSelect idPrefix="in" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="in-amount">Amount</Label>
        <Input id="in-amount" name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" placeholder="0.00" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="in-note">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="in-note" name="note" placeholder="e.g. Opening float" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm">Cash in recorded.</p>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending ? "Recording…" : "Add cash in"}
      </Button>
    </form>
  );
}

function CountForm() {
  const [state, formAction, isPending] = useActionState(
    recordCount,
    countInitial
  );
  const result = state.result;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <AccountSelect idPrefix="count" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="counted">Balance you counted / checked</Label>
        <Input id="counted" name="counted" type="number" step="0.01" min="0" required inputMode="decimal" placeholder="0.00" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {result ? (
        <div role="status" className="rounded-lg border p-3 text-sm">
          <p>
            {MONEY_ACCOUNT_LABELS[result.account]}: counted{" "}
            {formatPeso(result.counted)} · system expected{" "}
            {formatPeso(result.expected)}
          </p>
          <p
            className={
              result.over_short === 0
                ? "font-medium"
                : result.over_short > 0
                  ? "font-medium text-green-700 dark:text-green-400"
                  : "font-medium text-destructive"
            }
          >
            {result.over_short === 0
              ? "Exact match — this account balances."
              : result.over_short > 0
                ? `Over by ${formatPeso(result.over_short)}`
                : `Short by ${formatPeso(Math.abs(result.over_short))}`}
          </p>
        </div>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending ? "Recording…" : "Record count"}
      </Button>
    </form>
  );
}

export default function VaultForms() {
  return (
    <Tabs defaultValue="count" className="w-full min-w-0">
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="count">Daily count</TabsTrigger>
        <TabsTrigger value="out">Cash out</TabsTrigger>
        <TabsTrigger value="in">Cash in</TabsTrigger>
      </TabsList>
      <TabsContent value="count" className="pt-3">
        <CountForm />
      </TabsContent>
      <TabsContent value="out" className="pt-3">
        <CashOutForm />
      </TabsContent>
      <TabsContent value="in" className="pt-3">
        <CashInForm />
      </TabsContent>
    </Tabs>
  );
}
