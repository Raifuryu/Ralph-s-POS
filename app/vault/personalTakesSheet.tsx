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
import { roundMoney } from "@/lib/pricing";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  voidServiceTransaction,
  voidTransaction,
  type VoidState,
} from "../transactionActions";
import {
  labelDebtor,
  payTakes,
  setTakeBasis,
  type PersonalTakeActionState,
} from "./actions";

const initialState: PersonalTakeActionState = { error: null };
const initialVoidState: VoidState = { error: null };

export type PersonalTake = {
  /** A cart taken on utang (transactions) or an e-service taken on utang
      (service_transactions) — one sheet over two tables. */
  kind: "sale" | "service";
  id: string;
  /** Parts of the same sale share this, so a cart and a service taken
      together read as one debt (and select together). */
  visit_id: string | null;
  created_at: string;
  debtor_name: string | null;
  debtor_description: string | null;
  settled_at: string | null;
  /** What this take is owed at right now — cost or selling price for a
      cart (see atSellingPrice), principal + fee for a service. */
  owed: number;
  /** Paid to date, summed from the vault deposits recorded against it, so
      it can't drift from what the vault says (see recordTakePayment). */
  paid: number;
  /** Cart takes only — the two amounts the basis toggle switches between.
      Equal to `owed` for a service. */
  costTotal: number;
  sellingTotal: number;
  atSellingPrice: boolean;
  items: { product_name: string; quantity: number; unit_price: number }[];
};

const ACCOUNTS: MoneyAccount[] = ["cash", "gcash", "maya"];

function remainingOf(take: PersonalTake): number {
  return roundMoney(Math.max(0, take.owed - take.paid));
}

function takeRef(take: PersonalTake): string {
  return `${take.kind}:${take.id}`;
}

/** "2 pcs Coke, 1 pc Bread" — comma-joined, no attempt at a full sentence,
    since this has to fit on one line in the collapsed row. */
function itemsSummary(items: PersonalTake["items"]): string {
  if (items.length === 0) return "No items recorded";
  return items.map((item) => `${item.quantity}× ${item.product_name}`).join(", ");
}

/** One take, expandable. Selection lives in the parent so a payment can
    cover several at once; everything else (naming the debtor, switching
    which amount it's owed at, voiding) acts on this take alone. */
function PersonalTakeRow({
  take,
  selected,
  onToggleSelect,
}: {
  take: PersonalTake;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const isSettled = take.settled_at !== null;
  const remaining = remainingOf(take);
  const partlyPaid = take.paid > 0 && !isSettled;
  const [expanded, setExpanded] = useState(false);
  const [debtorName, setDebtorName] = useState(take.debtor_name ?? "");
  const [debtorDescription, setDebtorDescription] = useState(
    take.debtor_description ?? ""
  );

  const [labelState, labelAction, isLabeling] = useActionState(
    labelDebtor,
    initialState
  );
  const [basisState, basisAction, isSwitchingBasis] = useActionState(
    setTakeBasis,
    initialState
  );
  // An unpaid take never appears in the sales feed (only payments do), so
  // this is the one place a mistaken take can still be voided.
  const [voidState, voidActionFn, isVoiding] = useActionState(
    take.kind === "service" ? voidServiceTransaction : voidTransaction,
    initialVoidState
  );

  return (
    <li className="rounded-lg border">
      <div className="flex items-start gap-2 p-3">
        {isSettled ? null : (
          <input
            type="checkbox"
            aria-label={`Select this take for payment (${formatPeso(remaining)} left)`}
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
        )}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular-nums">
                {formatPeso(remaining)}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  left of {formatPeso(take.owed)}
                </span>
              </span>
              {isSettled ? (
                <Badge className="bg-success/10 text-success">Paid</Badge>
              ) : partlyPaid ? (
                <Badge className="bg-warning/10 text-warning">
                  {formatPeso(take.paid)} paid
                </Badge>
              ) : null}
              {take.kind === "service" ? (
                <Badge className="bg-muted text-muted-foreground">
                  E-service
                </Badge>
              ) : null}
            </span>
            {/* Both amounts at a glance, with the one being charged
                marked — the comparison the owner reads these rows for.
                Only when they actually differ, and only on a cart take
                (a service is owed one figure). */}
            {take.kind === "sale" && take.sellingTotal !== take.costTotal ? (
              <span className="block text-xs text-muted-foreground tabular-nums">
                {formatPeso(take.costTotal)} cost ·{" "}
                {formatPeso(take.sellingTotal)} selling
                <span className="font-medium">
                  {" "}
                  — charging {take.atSellingPrice ? "selling" : "cost"}
                </span>
              </span>
            ) : null}
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
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t p-3 pt-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">
              {take.kind === "service" ? "Service taken" : "Items taken"}
            </Label>
            {take.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No items recorded</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {take.items.map((item, i) => (
                  // No item id in this shape — index is stable here since
                  // the list itself never reorders.
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 truncate">{item.product_name}</span>
                    <span className="shrink-0 tabular-nums">
                      ×{item.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Which amount this take is owed at. Cart takes only — a service
              is owed exactly its principal + fee — and only while nothing
              has been paid yet, since a balance someone is part-way
              through paying can't move under them. */}
          {take.kind === "sale" &&
          !isSettled &&
          take.paid === 0 &&
          take.sellingTotal !== take.costTotal ? (
            <form action={basisAction} className="flex flex-col gap-1">
              <input type="hidden" name="transaction_id" value={take.id} />
              <input
                type="hidden"
                name="at_selling_price"
                value={take.atSellingPrice ? "0" : "1"}
              />
              <Label className="text-xs">Charge at</Label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {take.atSellingPrice
                    ? `Selling price ${formatPeso(take.sellingTotal)}`
                    : `Cost ${formatPeso(take.costTotal)}`}
                </span>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={isSwitchingBasis}
                >
                  {isSwitchingBasis
                    ? "Switching…"
                    : take.atSellingPrice
                      ? `Use cost ${formatPeso(take.costTotal)}`
                      : `Use selling ${formatPeso(take.sellingTotal)}`}
                </Button>
              </div>
              {basisState.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {basisState.error}
                </p>
              ) : null}
            </form>
          ) : null}

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
            <Label htmlFor={`debtor-description-${take.id}`} className="text-xs">
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
            <input type="hidden" name="kind" value={take.kind} />
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
              Paid in full {formatDateTime(take.settled_at!)}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Tick this take above, then record a payment at the bottom of
                the sheet — part of it or all of it.
              </p>

              {voidState.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {voidState.error}
                </p>
              ) : null}
              {take.paid === 0 ? (
                <form
                  action={voidActionFn}
                  onSubmit={(event) => {
                    if (
                      !confirm(
                        take.kind === "service"
                          ? "Void this take? Whatever it moved in the vault will be reversed. This can't be undone."
                          : "Void this take? Stock will be returned. This can't be undone."
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="id" value={take.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={isVoiding}
                    className="w-full text-destructive hover:text-destructive"
                  >
                    {isVoiding ? "Voiding…" : "Void this take"}
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Part of this has already been paid, so it can no longer be
                  voided.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

type DebtorGroup = {
  key: string;
  name: string;
  takes: PersonalTake[];
  /** Still owed across this debtor's takes — what a payment would go
      against, rather than the original value of everything they took. */
  remaining: number;
};

/** Compresses a list of takes down to one row per debtor, each carrying
    its own outstanding balance. Unlabeled takes group together under their
    own row. Sorted by balance descending — whoever owes the most first. */
function buildDebtorGroups(takes: PersonalTake[]): DebtorGroup[] {
  const map = new Map<string, DebtorGroup>();
  for (const take of takes) {
    const key = take.debtor_name ?? "";
    const existing = map.get(key);
    if (existing) {
      existing.takes.push(take);
      existing.remaining = roundMoney(existing.remaining + remainingOf(take));
    } else {
      map.set(key, {
        key,
        name: take.debtor_name ?? "Not labeled yet",
        takes: [take],
        remaining: remainingOf(take),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.remaining - a.remaining);
}

function DebtorGroupRow({
  group,
  selectedRefs,
  onToggleSelect,
  onToggleGroup,
}: {
  group: DebtorGroup;
  selectedRefs: Set<string>;
  onToggleSelect: (take: PersonalTake) => void;
  onToggleGroup: (takes: PersonalTake[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const outstandingCount = group.takes.filter((t) => t.settled_at === null).length;

  return (
    <li className="rounded-lg border">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="min-w-0">
            <span
              className={cn(
                "block text-sm font-medium",
                group.key === "" && "font-normal italic text-muted-foreground"
              )}
            >
              {group.name}
            </span>
            <span className="block text-xs text-muted-foreground">
              {group.takes.length} take{group.takes.length === 1 ? "" : "s"}
              {outstandingCount > 0 && outstandingCount < group.takes.length
                ? ` · ${outstandingCount} outstanding`
                : ""}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-medium tabular-nums">
              {formatPeso(group.remaining)}
            </span>
            {expanded ? (
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            )}
          </span>
        </button>
        {outstandingCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onToggleGroup(group.takes)}
          >
            Select all
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <ul className="flex flex-col gap-2 border-t p-2">
          {group.takes.map((take) => (
            <PersonalTakeRow
              key={takeRef(take)}
              take={take}
              selected={selectedRefs.has(takeRef(take))}
              onToggleSelect={() => onToggleSelect(take)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Every personal take ("Utang") not yet voided — carts and e-services
 * alike, across both tables. A take posts nothing to the vault when it
 * happens; this is where the owner records the debtor paying it back,
 * which can be in parts: tick one or more takes, type how much was handed
 * over, and the payment is applied oldest debt first (see
 * recordTakePayment). URL-driven (?debts) like the other Vault sheets.
 */
export default function PersonalTakesSheet({
  open,
  takes,
}: {
  open: boolean;
  takes: PersonalTake[];
}) {
  const router = useRouter();

  // Local, not driven purely by the `open` prop — a swipe-to-close needs to
  // animate away instantly rather than waiting on its URL round trip.
  const [openState, setOpenState] = useState({ prop: open, value: open });
  if (openState.prop !== open) {
    setOpenState({ prop: open, value: open });
  }
  const drawerOpen = openState.value;

  const [showAll, setShowAll] = useState(false);
  const [groupByDebtor, setGroupByDebtor] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [account, setAccount] = useState<MoneyAccount>("cash");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);

  const [payState, payAction, isPaying] = useActionState(payTakes, initialState);

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
  const visibleRemaining = roundMoney(
    visible.reduce((sum, take) => sum + remainingOf(take), 0)
  );
  const debtorGroups = buildDebtorGroups(visible);

  const selectedTakes = takes.filter((take) => selectedRefs.has(takeRef(take)));
  const selectedBalance = roundMoney(
    selectedTakes.reduce((sum, take) => sum + remainingOf(take), 0)
  );
  // The amount defaults to settling the selection in full, but stays
  // editable — typing less is exactly what a partial payment is.
  const amountValue = amountTouched ? amount : selectedBalance.toFixed(2);
  const amountNum = Number(amountValue);
  const amountInvalid =
    !Number.isFinite(amountNum) || amountNum <= 0 || amountNum > selectedBalance;

  function toggleSelect(take: PersonalTake) {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      const ref = takeRef(take);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
    setAmountTouched(false);
  }

  function toggleGroup(groupTakes: PersonalTake[]) {
    const payable = groupTakes.filter((take) => take.settled_at === null);
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      const allSelected = payable.every((take) => next.has(takeRef(take)));
      for (const take of payable) {
        if (allSelected) next.delete(takeRef(take));
        else next.add(takeRef(take));
      }
      return next;
    });
    setAmountTouched(false);
  }

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
            Items and e-services taken without paying. Tick what&rsquo;s being
            paid, type how much was handed over — part of it is fine — and it
            goes against the oldest first.
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

              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                <FilterChip
                  label="Grouped by name"
                  active={groupByDebtor}
                  onClick={() => setGroupByDebtor(true)}
                />
                <FilterChip
                  label="Individual"
                  active={!groupByDebtor}
                  onClick={() => setGroupByDebtor(false)}
                />
              </div>

              {visible.length > 0 ? (
                <div className="mb-3 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    {showAll ? "Still owed, all takes" : "Still owed"}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatPeso(visibleRemaining)}
                  </p>
                </div>
              ) : null}

              {visible.length === 0 ? (
                <EmptyState
                  title={
                    filtersActive
                      ? "No personal takes match these filters."
                      : "Nothing outstanding — all settled up."
                  }
                />
              ) : groupByDebtor ? (
                <ul className="flex flex-col gap-2">
                  {debtorGroups.map((group) => (
                    <DebtorGroupRow
                      key={group.key}
                      group={group}
                      selectedRefs={selectedRefs}
                      onToggleSelect={toggleSelect}
                      onToggleGroup={toggleGroup}
                    />
                  ))}
                </ul>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visible.map((take) => (
                    <PersonalTakeRow
                      key={takeRef(take)}
                      take={take}
                      selected={selectedRefs.has(takeRef(take))}
                      onToggleSelect={() => toggleSelect(take)}
                    />
                  ))}
                </ul>
              )}

              {/* The payment itself — one amount against everything ticked,
                  whichever debts those are. The debtor is shown on each row
                  above so a payment doesn't get pointed at the wrong
                  person's utang by accident. */}
              {selectedTakes.length > 0 ? (
                <form
                  action={payAction}
                  className="sticky bottom-0 mt-3 flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-lg"
                >
                  <input
                    type="hidden"
                    name="takes"
                    value={selectedTakes.map(takeRef).join(",")}
                  />
                  <input type="hidden" name="account" value={account} />
                  <input type="hidden" name="amount" value={amountValue} />
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      {selectedTakes.length} selected
                    </p>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {formatPeso(selectedBalance)} owed
                    </p>
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor="take-payment-amount" className="text-xs">
                      Amount paid
                    </Label>
                    <Input
                      id="take-payment-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={selectedBalance}
                      inputMode="decimal"
                      value={amountValue}
                      onChange={(event) => {
                        setAmount(event.target.value);
                        setAmountTouched(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {amountInvalid
                        ? `Enter an amount up to ${formatPeso(selectedBalance)}.`
                        : `${formatPeso(roundMoney(selectedBalance - amountNum))} will still be owed after this.`}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1">
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
                  </div>

                  {payState.error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {payState.error}
                    </p>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedRefs(new Set());
                        setAmountTouched(false);
                      }}
                    >
                      Clear
                    </Button>
                    <Button type="submit" size="sm" disabled={isPaying || amountInvalid}>
                      {isPaying ? "Recording…" : "Record payment"}
                    </Button>
                  </div>
                </form>
              ) : null}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
