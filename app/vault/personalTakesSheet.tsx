"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { EmptyState } from "@/components/emptyState";
import { FilterChip } from "@/components/filterChip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import {
  labelDebtor,
  settleDebt,
  type PersonalTakeActionState,
} from "./actions";

const initialState: PersonalTakeActionState = { error: null };

export type PersonalTake = {
  id: string;
  total: number;
  created_at: string;
  debtor_name: string | null;
  debtor_description: string | null;
  settled_at: string | null;
};

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

function PersonalTakeRow({ take }: { take: PersonalTake }) {
  const isSettled = take.settled_at !== null;
  const [expanded, setExpanded] = useState(false);
  const [debtorName, setDebtorName] = useState(take.debtor_name ?? "");
  const [debtorDescription, setDebtorDescription] = useState(
    take.debtor_description ?? ""
  );
  const [account, setAccount] = useState<MoneyAccount>("cash");

  const [labelState, labelAction, isLabeling] = useActionState(
    labelDebtor,
    initialState
  );
  const [settleState, settleActionFn, isSettling] = useActionState(
    settleDebt,
    initialState
  );

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {formatPeso(take.total)}
            </span>
            {isSettled ? (
              <Badge className="bg-success/10 text-success">Paid</Badge>
            ) : null}
          </span>
          <span className="block text-xs text-muted-foreground">
            {take.debtor_name ? (
              take.debtor_name
            ) : (
              <span className="italic">Not labeled yet</span>
            )}
            {" · "}
            {formatDateTime(take.created_at)}
          </span>
          {take.debtor_description ? (
            <span className="block truncate text-xs text-muted-foreground">
              {take.debtor_description}
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t p-3 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`debtor-name-${take.id}`} className="text-xs">
              Debtor name
            </Label>
            <Input
              id={`debtor-name-${take.id}`}
              placeholder="e.g. Kuya Jun"
              value={debtorName}
              onChange={(event) => setDebtorName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label
              htmlFor={`debtor-description-${take.id}`}
              className="text-xs"
            >
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id={`debtor-description-${take.id}`}
              placeholder="e.g. Rice and canned goods, promised end of month"
              value={debtorDescription}
              onChange={(event) => setDebtorDescription(event.target.value)}
            />
          </div>

          <form action={labelAction} className="flex flex-col gap-1">
            <input type="hidden" name="transaction_id" value={take.id} />
            <input type="hidden" name="debtor_name" value={debtorName} />
            <input
              type="hidden"
              name="debtor_description"
              value={debtorDescription}
            />
            {labelState.error ? (
              <p role="alert" className="text-xs text-destructive">
                {labelState.error}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={isLabeling}
              className="self-start"
            >
              {isLabeling ? "Saving…" : "Save name"}
            </Button>
          </form>

          {isSettled ? (
            <p className="text-xs text-muted-foreground">
              Paid {formatDateTime(take.settled_at!)}
            </p>
          ) : (
            <form
              action={settleActionFn}
              className="flex flex-col gap-2 border-t pt-3"
            >
              <input type="hidden" name="transaction_id" value={take.id} />
              <input type="hidden" name="debtor_name" value={debtorName} />
              <input
                type="hidden"
                name="debtor_description"
                value={debtorDescription}
              />
              <Label className="text-xs">Paid into</Label>
              <Tabs
                value={account}
                onValueChange={(value) => setAccount(value as MoneyAccount)}
              >
                <TabsList className="w-full">
                  {ACCOUNTS.map((acct) => (
                    <TabsTrigger key={acct} value={acct} className="flex-1">
                      {MONEY_ACCOUNT_LABELS[acct]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <input type="hidden" name="account" value={account} />
              {settleState.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {settleState.error}
                </p>
              ) : null}
              <Button type="submit" size="sm" disabled={isSettling}>
                {isSettling
                  ? "Recording…"
                  : `Mark ${formatPeso(take.total)} as paid`}
              </Button>
            </form>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Every personal take ("Utang") not yet voided, newest-first within
 * outstanding/paid — a personal take posts nothing to the vault at the time
 * it's taken (see checkout()'s "no income" comment), so this is how the
 * owner eventually records the debtor paying it back: label who it was (if
 * not already), then mark it paid into whichever account the money actually
 * landed in. URL-driven (?debts) like the other Vault/Inventory sheets.
 */
export default function PersonalTakesSheet({
  open,
  takes,
}: {
  open: boolean;
  takes: PersonalTake[];
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

  const [showAll, setShowAll] = useState(false);
  const outstanding = takes.filter((t) => t.settled_at === null);
  const visible = showAll ? takes : outstanding;

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
          <DrawerTitle>Personal takes</DrawerTitle>
          <DrawerDescription>
            Stock taken without a sale — label who it was for, then mark it
            paid once they settle up. Nothing reaches the vault until then.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {takes.length === 0 ? (
            <EmptyState title="No personal takes recorded yet." />
          ) : (
            <>
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                <FilterChip
                  label={`Outstanding (${outstanding.length})`}
                  active={!showAll}
                  onClick={() => setShowAll(false)}
                />
                <FilterChip
                  label={`All (${takes.length})`}
                  active={showAll}
                  onClick={() => setShowAll(true)}
                />
              </div>

              {visible.length === 0 ? (
                <EmptyState title="Nothing outstanding — all settled up." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {visible.map((take) => (
                    <PersonalTakeRow key={take.id} take={take} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
