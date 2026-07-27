"use client";

import { useActionState, useEffect } from "react";

import { EmptyState } from "@/components/emptyState";
import { Badge } from "@/components/ui/badge";
import {
  formatPeso,
  formatTime,
  friendlyDayLabel,
  storeDayKey,
} from "@/lib/format";
import {
  MONEY_ACCOUNT_LABELS,
  PAYMENT_METHOD_LABELS,
  type SalesEntry,
  type TransactionItem,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  voidServiceTransaction,
  voidTransaction,
  type VoidState,
} from "./transactionActions";

const initialVoidState: VoidState = { error: null };

/** An entry plus its 1-based position in the overall (pre-grouping) list —
    what the row number on the left shows. */
type NumberedEntry = { number: number; entry: SalesEntry };

type DayGroup = {
  key: string;
  label: string;
  /** Real income for the day — a sale's profit (never its gross total,
      never for a personal take, and never for a voided sale) plus every
      service's fee. Never principal: that just passes through. */
  total: number;
  entries: NumberedEntry[];
};

/** Real profit on a sale's line items (price - cost), not gross revenue —
    same reasoning as the dashboard's "Store profit" card and Statistics'
    "Gross profit" KPI (see migration 0021). A line only has a known margin
    once its product has been restocked through the app at least once;
    revenueWithUnknownCost tracks how much of the sale's total couldn't be
    included, so callers can tell "no profit" apart from "unknown profit"
    instead of silently showing ₱0. */
function saleProfit(items: TransactionItem[]) {
  let profit = 0;
  let revenueWithUnknownCost = 0;
  for (const item of items) {
    const lineRevenue = Number(item.line_total);
    if (item.unit_cost !== null) {
      profit += lineRevenue - Number(item.unit_cost) * item.quantity;
    } else {
      revenueWithUnknownCost += lineRevenue;
    }
  }
  return { profit, revenueWithUnknownCost };
}

/** Income contributed by one entry — the figure day totals sum. Sales count
    their real profit, not the gross total — matching how a service entry
    already only counts its fee, never the pass-through principal. A voided
    entry (sale or service) contributes nothing: whatever it posted has been
    reversed, so it's not really income anymore, just a struck-through
    record of a mistake. */
function entryIncome(entry: SalesEntry): number {
  if (entry.data.voided_at) return 0;
  if (entry.kind === "sale") {
    if (entry.data.is_personal_take) return 0;
    return saleProfit(entry.data.transaction_items).profit;
  }
  return Number(entry.data.fee);
}

/**
 * Groups by calendar day in the STORE's timezone — grouping by server-local
 * dates would split days at 8am Manila once deployed on a UTC host.
 * Entries arrive newest-first, so groups come out newest-first too.
 */
function groupByDay(entries: SalesEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  entries.forEach((entry, i) => {
    const key = storeDayKey(entry.data.created_at);
    const income = entryIncome(entry);
    const current = groups[groups.length - 1];
    const numbered: NumberedEntry = { number: i + 1, entry };
    if (current && current.key === key) {
      current.entries.push(numbered);
      current.total += income;
    } else {
      groups.push({
        key,
        label: friendlyDayLabel(entry.data.created_at),
        total: income,
        entries: [numbered],
      });
    }
  });
  return groups;
}

/** Row number shown on the left — position in the list, not a database id. */
function RowNumber({ number }: { number: number }) {
  return (
    <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">
      {number}
    </span>
  );
}

function SaleBlock({
  number,
  transaction,
}: {
  number: number;
  transaction: SalesEntry & { kind: "sale" };
}) {
  const { data } = transaction;
  const tendered = data.tendered !== null ? Number(data.tendered) : null;
  const total = Number(data.total);
  const isVoided = data.voided_at !== null;
  const { profit, revenueWithUnknownCost } = saleProfit(data.transaction_items);
  // Nothing sold on a personal take has a margin — it was never income to
  // begin with, so the headline stays the value taken, same as always.
  const allCostUnknown = !data.is_personal_take && revenueWithUnknownCost >= total;
  const partialCostUnknown =
    !data.is_personal_take && revenueWithUnknownCost > 0 && !allCostUnknown;

  const [state, formAction, isPending] = useActionState(
    voidTransaction,
    initialVoidState
  );

  useEffect(() => {
    if (state.error) alert(state.error);
  }, [state.error]);

  function handleClick() {
    if (isVoided || isPending) return;
    const noun = data.is_personal_take ? "take" : "sale";
    const consequence = data.is_personal_take
      ? "Stock will be returned."
      : "Stock will be returned and the income removed from the vault.";
    if (!confirm(`Void this ${noun}? ${consequence} This can't be undone.`)) {
      return;
    }
    const fd = new FormData();
    fd.set("id", data.id);
    formAction(fd);
  }

  return (
    <div
      role="button"
      tabIndex={isVoided ? -1 : 0}
      aria-disabled={isVoided || isPending}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "-mx-2 flex gap-2 border-b border-l-2 px-2 py-2.5 transition-colors last:border-b-0",
        isVoided
          ? "cursor-default border-l-destructive bg-destructive/5 opacity-70"
          : "cursor-pointer border-l-transparent hover:bg-muted/50 active:bg-muted",
        isPending && "opacity-50"
      )}
    >
      <RowNumber number={number} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            {formatTime(data.created_at)}
            <span className="ml-2 font-normal text-muted-foreground">
              {data.is_personal_take
                ? "Personal take"
                : PAYMENT_METHOD_LABELS[data.payment_method!]}
            </span>
            {isVoided ? (
              <Badge className="ml-2 bg-destructive/10 align-middle text-destructive">
                Voided
              </Badge>
            ) : null}
          </p>
          {isVoided ? null : data.is_personal_take ? (
            <p className="text-sm font-semibold tabular-nums">
              {formatPeso(total)}
            </p>
          ) : allCostUnknown ? (
            <p className="text-sm font-medium text-muted-foreground italic">
              Cost unknown
            </p>
          ) : (
            <p className="text-sm font-semibold tabular-nums">
              +{formatPeso(profit)}
              {partialCostUnknown ? "*" : ""}
            </p>
          )}
        </div>

        {!data.is_personal_take && !isVoided ? (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {formatPeso(total)} total
            {partialCostUnknown
              ? ` · *${formatPeso(revenueWithUnknownCost)} of that has no recorded cost yet`
              : ""}
          </p>
        ) : null}

        <div
          className={cn(
            "mt-1 flex flex-col gap-0.5",
            isVoided && "line-through decoration-destructive/50"
          )}
        >
          {data.transaction_items.map((item) => (
            <div
              key={item.id}
              className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
            >
              <span className="min-w-0 truncate">
                {item.product_name}
                <span className="tabular-nums">
                  {" "}
                  · {item.quantity} × {formatPeso(Number(item.unit_price))}
                </span>
              </span>
              <span className="tabular-nums">
                {formatPeso(Number(item.line_total))}
              </span>
            </div>
          ))}
        </div>

        {isVoided ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatPeso(total)} {data.is_personal_take ? "value" : "sale"} reversed
            {data.void_reason ? ` · ${data.void_reason}` : ""}
          </p>
        ) : tendered !== null ? (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            Given {formatPeso(tendered)} · change{" "}
            {formatPeso(tendered - Number(data.total))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ServiceBlock({
  number,
  service,
}: {
  number: number;
  service: SalesEntry & { kind: "service" };
}) {
  const { data } = service;
  const tendered = data.tendered !== null ? Number(data.tendered) : null;
  const due = Number(data.principal) + Number(data.fee);
  const isVoided = data.voided_at !== null;

  const [state, formAction, isPending] = useActionState(
    voidServiceTransaction,
    initialVoidState
  );

  useEffect(() => {
    if (state.error) alert(state.error);
  }, [state.error]);

  function handleClick() {
    if (isVoided || isPending) return;
    if (
      !confirm(
        "Void this service transaction? The income it posted will be removed from the vault. This can't be undone."
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("id", data.id);
    formAction(fd);
  }

  return (
    <div
      role="button"
      tabIndex={isVoided ? -1 : 0}
      aria-disabled={isVoided || isPending}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "-mx-2 flex gap-2 border-b border-l-2 px-2 py-2.5 transition-colors last:border-b-0",
        isVoided
          ? "cursor-default border-l-destructive bg-destructive/5 opacity-70"
          : "cursor-pointer border-l-transparent hover:bg-muted/50 active:bg-muted",
        isPending && "opacity-50"
      )}
    >
      <RowNumber number={number} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium">
            {formatTime(data.created_at)}
            <span className="ml-2 font-normal text-muted-foreground">
              {data.service_name}
            </span>
            {isVoided ? (
              <Badge className="ml-2 bg-destructive/10 align-middle text-destructive">
                Voided
              </Badge>
            ) : null}
          </p>
          {isVoided ? null : (
            <p className="shrink-0 text-sm font-semibold tabular-nums">
              +{formatPeso(Number(data.fee))}
            </p>
          )}
        </div>

        <p
          className={cn(
            "mt-0.5 text-xs text-muted-foreground tabular-nums",
            isVoided && "line-through decoration-destructive/50"
          )}
        >
          {formatPeso(Number(data.principal))} {data.cash_flow === "in" ? "via" : "to"}{" "}
          {MONEY_ACCOUNT_LABELS[data.payment_account]}
          {data.wallet ? ` · ${MONEY_ACCOUNT_LABELS[data.wallet]} wallet` : ""}
        </p>

        {data.reference || data.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[data.reference, data.description].filter(Boolean).join(" · ")}
          </p>
        ) : null}

        {isVoided ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatPeso(due)} reversed
            {data.void_reason ? ` · ${data.void_reason}` : ""}
          </p>
        ) : tendered !== null ? (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            Given {formatPeso(tendered)} · change {formatPeso(tendered - due)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function TransactionTable({
  entries,
}: {
  entries: SalesEntry[];
}) {
  if (entries.length === 0) {
    return <EmptyState title="No transactions recorded yet." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {groupByDay(entries).map((group) => (
        <section
          key={group.key}
          className="rounded-lg border bg-card px-4 py-2"
        >
          <div className="flex items-baseline justify-between gap-2 border-b pb-2 pt-1">
            <h3 className="text-sm font-semibold">
              {group.label}{" "}
              <Badge className="ml-1">
                {group.entries.length}{" "}
                {group.entries.length === 1 ? "entry" : "entries"}
              </Badge>
            </h3>
            <p className="text-sm font-semibold tabular-nums">
              {formatPeso(group.total)}
            </p>
          </div>
          {group.entries.map(({ number, entry }) =>
            entry.kind === "sale" ? (
              <SaleBlock key={entry.data.id} number={number} transaction={entry} />
            ) : (
              <ServiceBlock key={entry.data.id} number={number} service={entry} />
            )
          )}
        </section>
      ))}
    </div>
  );
}
