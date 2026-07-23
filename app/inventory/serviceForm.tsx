"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  MONEY_ACCOUNTS,
  MONEY_ACCOUNT_LABELS,
  parseFeeTiers,
  type Service,
} from "@/lib/types";
import {
  createService,
  updateService,
  type ServiceFormState,
} from "./serviceActions";

const initialState: ServiceFormState = { error: null };

type TierDraft = { key: string; min: string; max: string; fee: string };

function emptyTier(): TierDraft {
  return { key: crypto.randomUUID(), min: "", max: "", fee: "" };
}

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

  // Fixed, index-based keys for tiers present on mount (not
  // crypto.randomUUID()) — this initializer runs during SSR too, and a
  // random key here would mismatch on hydration. Tiers added later via "Add
  // tier" only ever happen from a client-side click, so those are safe to
  // key randomly.
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    parseFeeTiers(service?.fee_tiers ?? []).map((tier, i) => ({
      key: `initial-${i}`,
      min: String(tier.min),
      max: tier.max === null ? "" : String(tier.max),
      fee: String(tier.fee),
    }))
  );

  function updateTier(key: string, patch: Partial<TierDraft>) {
    setTiers((prev) =>
      prev.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier))
    );
  }

  function removeTier(key: string) {
    setTiers((prev) => prev.filter((tier) => tier.key !== key));
  }

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

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
        <div>
          <p className="text-sm font-medium">
            Fee tiers{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Fee changes with the amount — e.g. ₱100–500 = ₱10, ₱501 and up =
            ₱12. Leave Max blank for an open-ended top tier. Falls back to
            the usual fee above for amounts no tier covers.
          </p>
        </div>

        {tiers.map((tier) => (
          <div key={tier.key} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`tier-min-${tier.key}`} className="text-xs">
                Min
              </Label>
              <Input
                id={`tier-min-${tier.key}`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="100"
                value={tier.min}
                onChange={(event) => updateTier(tier.key, { min: event.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`tier-max-${tier.key}`} className="text-xs">
                Max
              </Label>
              <Input
                id={`tier-max-${tier.key}`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="and up"
                value={tier.max}
                onChange={(event) => updateTier(tier.key, { max: event.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`tier-fee-${tier.key}`} className="text-xs">
                Fee
              </Label>
              <Input
                id={`tier-fee-${tier.key}`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="10"
                value={tier.fee}
                onChange={(event) => updateTier(tier.key, { fee: event.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove this tier"
              onClick={() => removeTier(tier.key)}
            >
              <XIcon />
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setTiers((prev) => [...prev, emptyTier()])}
        >
          <PlusIcon data-icon="inline-start" />
          Add tier
        </Button>

        <input
          type="hidden"
          name="fee_tiers"
          value={JSON.stringify(
            tiers.map((tier) => ({
              min: tier.min,
              max: tier.max,
              fee: tier.fee,
            }))
          )}
        />
      </div>

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
