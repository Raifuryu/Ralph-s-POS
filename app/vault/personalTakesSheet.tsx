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
import { formatDateTime, formatPeso, storeDayKey } from "@/lib/format";
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
  /** What was actually taken — product_name/unit_price are the line's own
      snapshot from the moment of the take (same as everywhere else
      transaction_items is read), so this stays correct even if the product
      is later renamed, repriced, or deleted. */
  items: { product_name: string; quantity: number; unit_price: number }[];
};

/** Sum of unit_price × quantity across a take's items — what they'd have
    sold for at the time of the take, offered as an alternative settlement
    amount to the take's own (cost-based) total. */
function sellingPriceTotal(items: PersonalTake["items"]): number {
  return items.reduce(
    (sum, item) => sum + Number(item.unit_price) * item.quantity,
    0
  );
}

/** "2 pcs Coke, 1 pc Bread" — comma-joined, no attempt at a full sentence,
    since this has to fit on one line in the collapsed row and still read
    fine as a longer wrapped list in the expanded one. */
function itemsSummary(items: PersonalTake["items"]): string {
  if (items.length === 0) return "No items recorded";
  return items
    .map((item) => `${item.quantity}× ${item.product_name}`)
    .join(", ");
}

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

function PersonalTakeRow({ take }: { take: PersonalTake }) {
  const isSettled = take.settled_at !== null;
  const priceTotal = sellingPriceTotal(take.items);
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
          <span className="block truncate text-xs text-muted-foreground">
            {itemsSummary(take.items)}
          </span>
        </span>
        {expanded ? (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t p-3 pt-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Items taken</Label>
            {take.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No items recorded
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {take.items.map((item, i) => (
                  // No item id in this shape (see PersonalTake) — index is
                  // stable here since the list itself never reorders.
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 truncate">
                      {item.product_name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      ×{item.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

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
              <div className="flex flex-col gap-1.5">
                <Button
                  type="submit"
                  name="at_selling_price"
                  value="0"
                  size="sm"
                  disabled={isSettling}
                >
                  {isSettling
                    ? "Recording…"
                    : `Mark ${formatPeso(take.total)} as paid (cost)`}
                </Button>
                {priceTotal > 0 && priceTotal !== take.total ? (
                  <Button
                    type="submit"
                    name="at_selling_price"
                    value="1"
                    variant="outline"
                    size="sm"
                    disabled={isSettling}
                  >
                    {isSettling
                      ? "Recording…"
                      : `Mark ${formatPeso(priceTotal)} as paid (selling price)`}
                  </Button>
                ) : null}
              </div>
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
  // Client-side, over the already-fetched (bounded) list — same reasoning
  // ItemsBrowser's search follows: no server round trip needed for a list
  // this size, and it composes for free with the Outstanding/All chip.
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const outstanding = takes.filter((t) => t.settled_at === null);

  const needle = search.trim().toLowerCase();
  function matches(take: PersonalTake): boolean {
    const dayKey = storeDayKey(take.created_at);
    if (fromDate && dayKey < fromDate) return false;
    if (toDate && dayKey > toDate) return false;
    if (needle === "") return true;
    const haystack = [
      take.debtor_name,
      take.debtor_description,
      ...take.items.map((item) => item.product_name),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  }

  const visible = (showAll ? takes : outstanding).filter(matches);
  const filtersActive = needle !== "" || fromDate !== "" || toDate !== "";

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
              <Input
                type="search"
                aria-label="Search personal takes"
                placeholder="Search debtor, description, or item…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                className="mb-3"
              />

              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="debts-from" className="text-xs">
                    From
                  </Label>
                  <Input
                    id="debts-from"
                    type="date"
                    value={fromDate}
                    max={toDate || undefined}
                    onChange={(event) => setFromDate(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="debts-to" className="text-xs">
                    To
                  </Label>
                  <Input
                    id="debts-to"
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(event) => setToDate(event.target.value)}
                  />
                </div>
              </div>

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
                <EmptyState
                  title={
                    filtersActive
                      ? "No personal takes match these filters."
                      : "Nothing outstanding — all settled up."
                  }
                />
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
