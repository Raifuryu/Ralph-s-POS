"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPeso } from "@/lib/format";

function toAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when an amount was entered but doesn't cover what's due. */
export function isShort(tendered: string, due: number): boolean {
  const amount = toAmount(tendered);
  return amount !== null && amount < due;
}

/**
 * "Customer gave" input with live change display, shared by the sale and
 * service drawers. Render it only when physical cash is handed over — the
 * input carries name="tendered", so unmounting also removes it from the form.
 * The parent should disable its submit button while `isShort(...)`.
 */
export default function ChangeCalculator({
  due,
  value,
  onChange,
}: {
  due: number;
  value: string;
  onChange: (next: string) => void;
}) {
  const amount = toAmount(value);
  const short = amount !== null && amount < due;

  return (
    <div className="grid shrink-0 grid-cols-2 items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="tendered">Customer gave</Label>
        <Input
          id="tendered"
          name="tendered"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          placeholder="Blank if exact"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div data-testid="change-line" className="pb-1 text-right">
        {amount !== null ? (
          short ? (
            <p className="text-sm font-medium text-destructive">
              Short {formatPeso(due - amount)}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Change</p>
              <p className="text-xl font-semibold tabular-nums">
                {formatPeso(amount - due)}
              </p>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
