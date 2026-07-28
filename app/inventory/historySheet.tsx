"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/emptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatDateTime, formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export type HistoryEntry =
  | {
      kind: "restock";
      id: string;
      quantity: number;
      cost: number;
      note: string | null;
      created_at: string;
      /** Revenue from this product's (non-voided, non-personal-take) sales
          since this batch was bought. */
      recovered: number;
    }
  | {
      kind: "sale";
      id: string;
      quantity: number;
      line_total: number;
      discount_amount: number;
      created_at: string;
      is_personal_take: boolean;
      voided_at: string | null;
      void_reason: string | null;
      payment_method: MoneyAccount | null;
    };

/**
 * Per-product history — restocks and sales interleaved, newest first — as a
 * bottom sheet, URL-driven (?history=<id>) like ProductSheet. "Recovered"
 * tracks cost-recovery on what the owner spent buying stock, not a supplier
 * balance — there's nobody being paid.
 */
export default function HistorySheet({
  open,
  productName,
  entries,
}: {
  open: boolean;
  productName?: string;
  entries: HistoryEntry[];
}) {
  const router = useRouter();

  // Reset back to the top PAGE_SIZE whenever a different product's history
  // is opened, rather than leaving a stale "load more" position from
  // whichever product was viewed previously. Adjusted during render, same
  // pattern as ItemsBrowser's filter reset.
  const [visible, setVisible] = useState({ key: productName, count: PAGE_SIZE });
  if (visible.key !== productName) {
    setVisible({ key: productName, count: PAGE_SIZE });
  }
  const visibleCount = visible.key === productName ? visible.count : PAGE_SIZE;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) router.push("/inventory", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>
            {productName ? `${productName} — history` : "History"}
          </DrawerTitle>
          <DrawerDescription>
            Every restock and sale of this item. Recovered is real revenue
            collected since each batch was bought — voided sales and personal
            takes don&apos;t count toward it. Older batches also get credit
            for sales after a later restock — there&apos;s no per-unit link
            back to which batch a sale came from, so treat it as a rough
            guide, not exact accounting.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {entries.length === 0 ? (
            <EmptyState title="No history recorded yet." />
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.slice(0, visibleCount).map((entry) =>
                entry.kind === "restock" ? (
                  <RestockRow key={`restock-${entry.id}`} entry={entry} />
                ) : (
                  <SaleRow key={`sale-${entry.id}`} entry={entry} />
                )
              )}
            </ul>
          )}
          {entries.length > visibleCount ? (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() =>
                setVisible((prev) => ({ ...prev, count: prev.count + PAGE_SIZE }))
              }
            >
              Show {Math.min(PAGE_SIZE, entries.length - visibleCount)} more (
              {entries.length - visibleCount} left)
            </Button>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function RestockRow({
  entry,
}: {
  entry: HistoryEntry & { kind: "restock" };
}) {
  const net = entry.recovered - entry.cost;
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="text-success">+{entry.quantity}</span> pc
          {entry.quantity === 1 ? "" : "s"} restocked ·{" "}
          {formatPeso(entry.cost)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(entry.created_at)}
        </p>
      </div>
      {entry.note ? (
        <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
      ) : null}
      <p className="mt-2 text-sm">
        <span
          className={net >= 0 ? "font-medium text-success" : "font-medium"}
        >
          {formatPeso(entry.recovered)} recovered
        </span>
        <span className="text-muted-foreground">
          {" "}
          {net >= 0
            ? `· +${formatPeso(net)} ahead`
            : `· ${formatPeso(-net)} short of cost`}
        </span>
      </p>
    </li>
  );
}

function SaleRow({ entry }: { entry: HistoryEntry & { kind: "sale" } }) {
  const isVoided = entry.voided_at !== null;
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        isVoided && "border-l-4 border-l-destructive bg-destructive/5 opacity-70"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "text-sm font-medium",
            isVoided && "line-through decoration-destructive/50"
          )}
        >
          <span>−{entry.quantity}</span> pc{entry.quantity === 1 ? "" : "s"}{" "}
          sold · {formatPeso(entry.line_total)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(entry.created_at)}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {entry.is_personal_take
          ? "Personal take"
          : entry.payment_method
            ? MONEY_ACCOUNT_LABELS[entry.payment_method]
            : "Sale"}
        {entry.discount_amount > 0
          ? ` · ${formatPeso(entry.discount_amount)} discount`
          : ""}
        {isVoided ? (
          <Badge className="ml-2 bg-destructive/10 align-middle text-destructive">
            Voided
          </Badge>
        ) : null}
      </p>
      {isVoided && entry.void_reason ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {entry.void_reason}
        </p>
      ) : null}
    </li>
  );
}
