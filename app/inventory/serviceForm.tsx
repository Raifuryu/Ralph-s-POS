"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MONEY_ACCOUNTS, MONEY_ACCOUNT_LABELS, type Service } from "@/lib/types";
import {
  createService,
  updateService,
  type ServiceFormState,
} from "./serviceActions";

const initialState: ServiceFormState = { error: null };

export default function ServiceForm({
  service,
}: {
  /** Omit to create a new service. */
  service?: Service;
}) {
  const isEdit = Boolean(service);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateService : createService,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {service ? <input type="hidden" name="id" value={service.id} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="service-name" className="text-xs">
          Name
        </Label>
        <Input
          id="service-name"
          name="name"
          required
          defaultValue={service?.name ?? ""}
          placeholder="e.g. GCash Cash-in (Load)"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="cash_flow" className="text-xs">
            Cash direction
          </Label>
          <Select
            id="cash_flow"
            name="cash_flow"
            defaultValue={service?.cash_flow ?? "in"}
          >
            <option value="in">In — customer pays cash into the box</option>
            <option value="out">Out — you hand cash to the customer</option>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="default_fee" className="text-xs">
            Usual fee{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="default_fee"
            name="default_fee"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            defaultValue={service?.default_fee ?? ""}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="wallet" className="text-xs">
          Wallet involved{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Select
          id="wallet"
          name="wallet"
          defaultValue={service?.wallet ?? ""}
        >
          <option value="">None — cash only (xerox, printing…)</option>
          <option value="gcash">GCash</option>
          <option value="maya">Maya</option>
        </Select>
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        The fee is your income and is typed at the counter each time — this
        default just pre-fills it. If a wallet is set, the vault tracks both
        sides: a load adds cash to the box and deducts the amount from that
        wallet; a cash-out does the reverse.
      </p>

      <div className="flex flex-col gap-2">
        <Label className="text-xs">Accepted payment methods</Label>
        <div className="flex flex-wrap gap-3">
          {MONEY_ACCOUNTS.map((account) => (
            <label
              key={account}
              className="flex items-center gap-1.5 text-sm"
            >
              <input
                type="checkbox"
                name="allowed_payment_accounts"
                value={account}
                defaultChecked={
                  service
                    ? service.allowed_payment_accounts.includes(account)
                    : account === "cash"
                }
                className="size-4 rounded border-input"
              />
              {MONEY_ACCOUNT_LABELS[account]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          At the counter, only these count as valid payment for this service.
          Most services should stay cash-only — paying a GCash load with
          GCash itself makes no sense.
        </p>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Add service"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/inventory?tab=services" />}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
