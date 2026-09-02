"use client";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPeso } from "@/lib/format";
import { roundMoney, toNumber } from "@/lib/pricing";
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";

export type PaymentSource = MoneyAccount | ProfitFund;

/** Cash/GCash/Maya first (physical), then the two funds — Profit and For
    Restock can pay for a restock directly, no transfer needed first (see
    recordBulkRestock's own doc comment). */
export const PAYMENT_SOURCES: { value: PaymentSource; label: string }[] = [
  { value: "cash", label: MONEY_ACCOUNT_LABELS.cash },
  { value: "gcash", label: MONEY_ACCOUNT_LABELS.gcash },
  { value: "maya", label: MONEY_ACCOUNT_LABELS.maya },
  { value: "profit", label: PROFIT_FUND_LABELS.profit },
  { value: "reinvest", label: PROFIT_FUND_LABELS.reinvest },
];

export function emptyPayment(): Record<PaymentSource, string> {
  return { cash: "", gcash: "", maya: "", profit: "", reinvest: "" };
}

// Rounded once at the end — summing several already-2-decimal amounts (up
// to 5 sources here) can still drift into e.g. 1886.6500000000003, which
// then fails the exact-match check against `total` even though it's the
// same peso amount (see roundMoney's own comment in lib/pricing.ts).
export function paymentTotal(paidWith: Record<PaymentSource, string>): number {
  return roundMoney(
    PAYMENT_SOURCES.reduce(
      (sum, source) => sum + (toNumber(paidWith[source.value]) || 0),
      0
    )
  );
}

/** Caps For Restock's own auto-fill at whatever it actually has — the rest
    is left for the owner to assign themselves, never silently spilled into
    another source. Used both by the "open the sheet" handler (the one-time
    default) and available for a caller to recompute if `total`/balance
    change before the field's been touched. */
export function autoFillReinvest(total: number, available: number): number {
  return roundMoney(Math.max(0, Math.min(total, available)));
}

/**
 * A required nested sheet (opens from within BulkRestockForm's own
 * already-open Drawer — Base UI's Drawer primitive supports this directly):
 * the last step before a restock actually records, showing the total owed
 * and which wallet(s) to draw it from. Controlled by the parent (`open`/
 * `onOpenChange`), which also owns when to open it — see BulkRestockForm's
 * own "Continue" button, which pre-fills For Restock up to whatever it has
 * available before opening this. The confirm button is the form's real
 * submit control (`form={formId}`), wired via the HTML `form` attribute
 * rather than DOM nesting — Base UI's Drawer portals this sheet's content
 * elsewhere in the document, so a plain nested `<button type="submit">`
 * without that attribute wouldn't find its way back to the cart's own
 * `<form>`.
 */
export default function RestockPaymentSheet({
  open,
  onOpenChange,
  formId,
  total,
  vaultBalances,
  fundBalances,
  paidWith,
  onChange,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** id of BulkRestockForm's own `<form>` — see this component's own doc
      comment on why the confirm button needs this instead of relying on
      DOM nesting. */
  formId: string;
  /** The batch's total cost — what "fully paid" means here; the confirm
      button stays disabled until the split adds up to exactly this. */
  total: number;
  vaultBalances: Map<MoneyAccount, number>;
  fundBalances: Map<ProfitFund, number>;
  paidWith: Record<PaymentSource, string>;
  onChange: (next: Record<PaymentSource, string>) => void;
  isPending: boolean;
}) {
  const paidTotal = paymentTotal(paidWith);
  const remaining = Math.max(0, total - paidTotal);

  function balanceFor(source: PaymentSource): number {
    if (source === "profit" || source === "reinvest") {
      return fundBalances.get(source) ?? 0;
    }
    return vaultBalances.get(source) ?? 0;
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Paid with</DrawerTitle>
          <DrawerDescription>
            Total needed: {formatPeso(total)}. For Restock is pre-filled up
            to what it has available — assign whatever&rsquo;s left to
            whichever wallet(s) covered the rest. Profit/For Restock can be
            spent from directly, no transfer needed first.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-3">
            {PAYMENT_SOURCES.map((source) => (
              <div key={source.value} className="flex flex-col gap-1">
                <Label htmlFor={`pay-${source.value}`} className="text-xs">
                  {source.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({formatPeso(balanceFor(source.value))} available)
                  </span>
                </Label>
                <Input
                  id={`pay-${source.value}`}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={paidWith[source.value]}
                  onChange={(event) =>
                    onChange({ ...paidWith, [source.value]: event.target.value })
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p className="text-sm">
            Paid:{" "}
            <span className="font-medium tabular-nums">
              {formatPeso(paidTotal)}
            </span>{" "}
            <span className="text-muted-foreground">
              of {formatPeso(total)}
            </span>
            {paidTotal > total ? (
              <span className="block text-xs text-destructive">
                More than the total
              </span>
            ) : remaining > 0 ? (
              <span className="block text-xs text-muted-foreground">
                {formatPeso(remaining)} left to assign
              </span>
            ) : null}
          </p>
          <div className="flex gap-2">
            <DrawerClose className="text-sm text-muted-foreground underline underline-offset-2">
              Back
            </DrawerClose>
            <Button
              type="submit"
              form={formId}
              size="sm"
              disabled={isPending || paidTotal !== total}
            >
              {isPending ? "Recording…" : "Record purchase"}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
