"use client";

import { useState } from "react";
import { ChevronLeftIcon, PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import {
  feeForPrincipal,
  MONEY_ACCOUNT_LABELS,
  parseFeeTiers,
  parseUnitPrices,
  type MoneyAccount,
  type Service
} from "@/lib/types";

/** One e-service line added to the sale, not yet submitted — everything
    record_service() needs, captured client-side. Nothing here has hit the
    server yet; it only does on the final "Record sale". Payment method
    isn't part of this — it's the sale's own single choice, applied to
    every line (and the cart) at submit time. */
export type ServiceDraft = {
  key: string;
  serviceId: string;
  label: string;
  cashFlow: "in" | "out";
  principal: number;
  fee: number;
  /** Cash-in only: whether the fee should come out of the amount rather
      than being collected on top — applied server-side against the
      service's real cash_flow, same as the old standalone flow did. */
  deductFee: boolean;
  feeInWallet: boolean;
  unitLabel: string | null;
  unitQuantity: number | null;
  unitPrice: number | null;
  contactNumber: string;
  reference: string;
  description: string;
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Common PH peso bill denominations — a GCash/Maya cash-in customer almost
    always hands over one of these, so tapping one is faster than typing it
    for the single most-filled field on this screen. */
const QUICK_AMOUNTS = [20, 50, 100, 200, 500, 1000];

/** Tier-matched fee for the amount, falling back to the service's flat
    default_fee when no tier covers it (or none are configured at all). */
function resolveFee(service: Service, principal: number): number | null {
  const tierFee = feeForPrincipal(parseFeeTiers(service.fee_tiers), principal);
  if (tierFee !== null) return tierFee;
  return service.default_fee !== null ? Number(service.default_fee) : null;
}

/** One row in the service picker — shared by the "E-Wallet" and "Per item"
    groups below, differing only in what the subtitle line summarizes.
    Tapping one leaves the list entirely for the config screen (see
    ServiceLineEditor below), so there's no "selected" state to show here —
    just a "×N" badge when it's already in the sale, same as a product row
    in the item picker. */
function ServiceRow({
  service,
  count,
  onPick
}: {
  service: Service;
  /** How many drafts of this service are already in the sale. */
  count: number;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Choose ${service.name}`}
      onClick={onPick}
      className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{service.name}</p>
        <p className="text-xs text-muted-foreground">
          {service.pricing_mode === "per_unit" ? (
            parseUnitPrices(service.unit_prices)
              .map((variant) => `${variant.label} ${formatPeso(variant.price)}`)
              .join(", ")
          ) : (
            <>
              {service.cash_flow === "in" ? "Customer pays in" : "You pay out"}
              {service.wallet
                ? ` · ${MONEY_ACCOUNT_LABELS[service.wallet]} wallet`
                : null}
              {parseFeeTiers(service.fee_tiers).length > 0
                ? " · tiered fee"
                : service.default_fee !== null
                  ? ` · usual fee ${formatPeso(Number(service.default_fee))}`
                  : null}
            </>
          )}
          {" · "}
          {service.allowed_payment_accounts
            .map((account) => MONEY_ACCOUNT_LABELS[account])
            .join(", ")}
        </p>
      </div>

      {count > 0 ? (
        <Badge variant="primary" className="shrink-0">
          ×{count}
        </Badge>
      ) : (
        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * Configures one e-service line and adds it to the sale's draft list —
 * everything ServiceSaleForm used to do, minus the server round-trip and
 * minus its own payment method/tendered: those are now the sale's single
 * shared choice (see CheckoutForm), same as how a product cart always
 * worked. Resets after each add so another service can be configured right
 * away.
 */
export default function ServiceLineEditor({
  services,
  balances,
  paymentMethod,
  drafts,
  onAdd,
  onClose
}: {
  services: Service[];
  /** Current vault balance per account — used to warn when a cash-in
      service tied to a wallet (e.g. GCash Load) would draw the wallet
      below zero; the wallet itself can't front money it doesn't have. */
  balances: Map<MoneyAccount, number>;
  /** The sale's single payment method, chosen once for the whole sale
      (cart + every service line) — not picked per service anymore. */
  paymentMethod: MoneyAccount;
  /** Service lines already in the sale — drives the per-row "×N" badge and
      the list screen's footer count. */
  drafts: ServiceDraft[];
  onAdd: (draft: ServiceDraft) => void;
  onClose: () => void;
}) {
  // Split by pricing mode, not by name — a per-unit service is grouped here
  // mechanically (by how it's sold), so any future one (not just Xerox)
  // lands in the right section automatically.
  const flatServices = services.filter((s) => s.pricing_mode !== "per_unit");
  const perUnitServices = services.filter((s) => s.pricing_mode === "per_unit");

  const draftCountByService = new Map<string, number>();
  for (const draft of drafts) {
    draftCountByService.set(
      draft.serviceId,
      (draftCountByService.get(draft.serviceId) ?? 0) + 1
    );
  }

  const [selected, setSelected] = useState<Service | null>(null);
  const [principal, setPrincipal] = useState("");
  const [fee, setFee] = useState("");
  // Once the cashier types into Fee directly, stop auto-filling it from the
  // amount/tiers — same "touched" pattern as the bulk restock calculator.
  const [feeTouched, setFeeTouched] = useState(false);
  // Cash-in only: some customers ask for the fee to come out of the load
  // instead of paying extra cash for it — an opt-in choice.
  const [deductFee, setDeductFee] = useState(false);
  // Cash-out only: whether the fee lands in cash (its own ledger line,
  // default) or gets embedded in the wallet-side transfer instead (the
  // customer sends the fee via GCash/Maya rather than handing over cash).
  const [feeInWallet, setFeeInWallet] = useState(false);
  // Per-unit services only (e.g. Xerox): which priced variant is picked and
  // how many — fee is derived from these, never typed directly.
  const [unitVariantIndex, setUnitVariantIndex] = useState<number | null>(null);
  const [unitQuantity, setUnitQuantity] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  // Per-unit: fee is quantity x the selected variant's price, and principal
  // is always 0 — the whole amount is income, there's no wallet pass-through
  // to split out (see migration 0026).
  const isPerUnit = selected?.pricing_mode === "per_unit";
  const unitPriceOptions = selected
    ? parseUnitPrices(selected.unit_prices)
    : [];
  const selectedVariant =
    isPerUnit && unitVariantIndex !== null
      ? (unitPriceOptions[unitVariantIndex] ?? null)
      : null;
  const unitQty = toNumber(unitQuantity);
  const unitTotal = selectedVariant ? selectedVariant.price * unitQty : 0;

  const principalNum = isPerUnit ? 0 : toNumber(principal);
  const feeNum = isPerUnit ? unitTotal : toNumber(fee);
  // Amount is required for a flat/tiered service — there's no such thing as
  // a ₱0 load or cash-out. Per-unit services have no Amount field at all
  // (principal is always 0 there — see above), so this only applies when
  // one is actually shown.
  const amountMissing = !isPerUnit && principalNum <= 0;
  const hasWallet = Boolean(selected?.wallet);
  const isCashOut = selected?.cash_flow === "out";
  const cashInEffectivePrincipal = deductFee
    ? Math.max(0, principalNum - feeNum)
    : principalNum;
  const feeExceedsAmount = deductFee && feeNum > principalNum;

  const tiers = selected ? parseFeeTiers(selected.fee_tiers) : [];
  const matchedTier =
    tiers.length > 0
      ? (tiers.find(
          (t) =>
            principalNum >= t.min && (t.max === null || principalNum <= t.max)
        ) ?? null)
      : null;

  // Shared by the raw input's onChange and the quick-amount chips below, so
  // tapping ₱100 does exactly what typing "100" would — including the same
  // tiered-fee auto-fill (only while the cashier hasn't touched Fee
  // directly, same "touched" pattern as the bulk restock calculator).
  function handlePrincipalChange(value: string) {
    setPrincipal(value);
    if (selected && !feeTouched && tiers.length > 0) {
      const resolved = resolveFee(selected, toNumber(value));
      if (resolved !== null) setFee(String(resolved));
    }
  }

  function pick(service: Service) {
    setSelected(service);
    setFeeTouched(false);
    setDeductFee(false);
    setFeeInWallet(false);
    setUnitVariantIndex(service.pricing_mode === "per_unit" ? 0 : null);
    setUnitQuantity("");
    const resolved = resolveFee(service, toNumber(principal));
    setFee(resolved !== null ? String(resolved) : "");
  }

  const payLabel = MONEY_ACCOUNT_LABELS[paymentMethod];
  const allowedAccounts = selected?.allowed_payment_accounts ?? ["cash"];
  // The sale's payment method might not be one this particular service
  // accepts (e.g. the sale is paying by Maya but this service is cash-only)
  // — record_service() would reject it server-side regardless, but this
  // catches it right where the cashier can do something about it.
  const paymentMismatch =
    Boolean(selected) && !allowedAccounts.includes(paymentMethod);

  const walletBalance =
    selected?.wallet !== undefined && selected?.wallet !== null
      ? (balances.get(selected.wallet) ?? 0)
      : null;
  const walletShort =
    selected?.cash_flow === "in" &&
    walletBalance !== null &&
    cashInEffectivePrincipal > walletBalance;

  function resetDraftFields() {
    setSelected(null);
    setPrincipal("");
    setFee("");
    setFeeTouched(false);
    setDeductFee(false);
    setFeeInWallet(false);
    setUnitVariantIndex(null);
    setUnitQuantity("");
    setContactNumber("");
    setReference("");
    setDescription("");
  }

  function handleAdd() {
    if (!selected) return;
    if (walletShort && selected.wallet) {
      const label = MONEY_ACCOUNT_LABELS[selected.wallet];
      if (
        !confirm(
          `This sends ${formatPeso(cashInEffectivePrincipal)} from ${label}, but its tracked balance is only ${formatPeso(walletBalance ?? 0)}.\n\nAdd anyway?`
        )
      ) {
        return;
      }
    }
    onAdd({
      key: crypto.randomUUID(),
      serviceId: selected.id,
      label: selected.name,
      cashFlow: selected.cash_flow,
      principal: principalNum,
      fee: feeNum,
      deductFee,
      feeInWallet,
      unitLabel: selectedVariant?.label ?? null,
      unitQuantity: isPerUnit ? unitQty : null,
      unitPrice: selectedVariant?.price ?? null,
      contactNumber,
      reference,
      description
    });
    resetDraftFields();
  }

  // Two screens, not one continuous scroll of list-then-config — same
  // rhythm as ItemPickerDrawer, whose picker is nothing but the list (a
  // product just adds itself on tap since there's nothing to configure).
  // A service needs configuring first, so tapping one here switches the
  // whole sheet to a dedicated config screen instead, with its own way
  // back rather than the list and the form competing for the same scroll.
  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {services.length === 0 ? (
            <EmptyState
              title="No services set up yet."
              subtitle="Add them under Inventory → Services."
            />
          ) : (
            <>
              {flatServices.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    E-Wallet
                  </p>
                  {flatServices.map((service) => (
                    <ServiceRow
                      key={service.id}
                      service={service}
                      count={draftCountByService.get(service.id) ?? 0}
                      onPick={() => pick(service)}
                    />
                  ))}
                </div>
              ) : null}
              {perUnitServices.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Per item
                  </p>
                  {perUnitServices.map((service) => (
                    <ServiceRow
                      key={service.id}
                      service={service}
                      count={draftCountByService.get(service.id) ?? 0}
                      onPick={() => pick(service)}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <DrawerFooter className="flex-row items-center justify-between border-t p-0 pt-4">
          <p className="text-sm text-muted-foreground">
            {drafts.length > 0
              ? `${drafts.length} added`
              : "No services added yet"}
          </p>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DrawerFooter>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <button
        type="button"
        onClick={() => setSelected(null)}
        className="-ml-1 flex w-fit items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Back to services
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {isPerUnit ? (
          <>
            <div className="flex flex-col gap-2">
              <Label className="text-xs">Variant</Label>
              <Tabs
                value={
                  unitVariantIndex !== null ? String(unitVariantIndex) : ""
                }
                onValueChange={(value) => setUnitVariantIndex(Number(value))}
                className="w-full min-w-0"
              >
                <TabsList className="w-full sm:w-fit">
                  {unitPriceOptions.map((variant, index) => (
                    <TabsTrigger key={variant.label} value={String(index)}>
                      {variant.label} · {formatPeso(variant.price)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="unit-quantity" className="text-xs">
                Quantity
              </Label>
              <Input
                id="unit-quantity"
                type="number"
                step="1"
                min="1"
                inputMode="numeric"
                placeholder="e.g. 20"
                value={unitQuantity}
                onChange={(event) => setUnitQuantity(event.target.value)}
              />
            </div>

            {selectedVariant && unitQty > 0 ? (
              <p className="-mt-2 text-xs text-muted-foreground">
                {unitQty} × {formatPeso(selectedVariant.price)} ={" "}
                <span className="font-medium text-foreground">
                  {formatPeso(unitTotal)}
                </span>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="principal" className="text-xs">
                  Amount <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="principal"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={principal}
                  onChange={(event) => handlePrincipalChange(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fee" className="text-xs">
                  Fee (your income)
                </Label>
                <Input
                  id="fee"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={fee}
                  onChange={(event) => {
                    setFee(event.target.value);
                    setFeeTouched(true);
                  }}
                />
              </div>
            </div>

            <div className="-mt-1 flex flex-wrap gap-1.5">
              {QUICK_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={`Set amount to ${formatPeso(amount)}`}
                  onClick={() => handlePrincipalChange(String(amount))}
                >
                  ₱{amount}
                </Button>
              ))}
            </div>

            {tiers.length > 0 ? (
              <p className="-mt-2 text-xs text-muted-foreground">
                {matchedTier ? (
                  <>
                    {formatPeso(matchedTier.min)}–
                    {matchedTier.max !== null
                      ? formatPeso(matchedTier.max)
                      : "up"}
                    {" → "}
                    <span className="font-medium text-foreground">
                      {formatPeso(matchedTier.fee)}
                    </span>
                    {!feeTouched
                      ? " — filled in above, adjust if you like."
                      : null}
                  </>
                ) : (
                  "No tier matches this amount — check the fee."
                )}
              </p>
            ) : null}
          </>
        )}

        {hasWallet && !isCashOut ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={deductFee}
              onCheckedChange={(checked) => setDeductFee(checked === true)}
            />
            Fee is already included in the amount above
          </label>
        ) : null}

        {isCashOut && hasWallet && selected.wallet ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={feeInWallet}
                onCheckedChange={(checked) => setFeeInWallet(checked === true)}
              />
              Fee is added to the {MONEY_ACCOUNT_LABELS[selected.wallet]} amount
              instead of cash
            </label>
            <p className="-mt-1 text-xs text-muted-foreground">
              {feeInWallet
                ? `Sent electronically — the customer's ${MONEY_ACCOUNT_LABELS[selected.wallet]} transfer covers the fee too, so cash just hands back the plain amount.`
                : "Received in cash, as its own entry in the Vault ledger. A customer who wants a round bill (e.g. ₱1,000 instead of ₱980) can just hand you the difference first; either way the box nets the same."}
            </p>
          </>
        ) : null}

        {feeExceedsAmount ? (
          <p className="text-xs text-destructive">
            Fee can&apos;t be more than the amount.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label className="text-xs">
            {selected.cash_flow === "in"
              ? "Customer pays via"
              : "Paid out from"}
          </Label>
          <p className="text-sm">
            {payLabel}
            <span className="text-xs text-muted-foreground">
              {" "}
              — set once for the whole sale
            </span>
          </p>
          {paymentMismatch ? (
            <p className="text-xs font-medium text-destructive">
              This service doesn&apos;t accept {payLabel} — switch the
              sale&apos;s payment method or remove this service.
            </p>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground" data-testid="box-effect">
          {selected.cash_flow === "in"
            ? `Adds ${formatPeso(cashInEffectivePrincipal + feeNum)} to ${payLabel}` +
              (selected.wallet
                ? ` · sends ${formatPeso(cashInEffectivePrincipal)} from ${MONEY_ACCOUNT_LABELS[selected.wallet]}.`
                : ".")
            : selected.wallet && feeInWallet
              ? `Takes ${formatPeso(principalNum)} from ${payLabel} · ${formatPeso(principalNum + feeNum)} arrives in ${MONEY_ACCOUNT_LABELS[selected.wallet]}.`
              : `Takes ${formatPeso(principalNum)} from ${payLabel}` +
                (feeNum > 0
                  ? `, ${formatPeso(feeNum)} of that back for the fee — nets ${formatPeso(principalNum - feeNum)}`
                  : "") +
                (selected.wallet
                  ? ` · ${formatPeso(principalNum)} arrives in ${MONEY_ACCOUNT_LABELS[selected.wallet]}.`
                  : ".")}
        </p>

        {walletShort && selected.wallet ? (
          <p
            data-testid="wallet-short"
            className="rounded-lg border border-warning/60 bg-warning/10 p-2 text-xs font-medium text-warning"
          >
            Only {formatPeso(walletBalance ?? 0)} tracked in{" "}
            {MONEY_ACCOUNT_LABELS[selected.wallet]} — this sends{" "}
            {formatPeso(cashInEffectivePrincipal)}.
          </p>
        ) : null}

        <Accordion className="shrink-0">
          <AccordionItem value="details" className="border-b-0">
            <AccordionTrigger className="py-1.5 text-xs">
              Add details (optional)
            </AccordionTrigger>
            <AccordionContent keepMounted>
              <div className="flex flex-col gap-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="contact_number" className="text-xs">
                      Number
                    </Label>
                    <Input
                      id="contact_number"
                      inputMode="tel"
                      placeholder="e.g. 09171234567"
                      value={contactNumber}
                      onChange={(event) => setContactNumber(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="reference" className="text-xs">
                      Reference no.
                    </Label>
                    <Input
                      id="reference"
                      placeholder="From the app"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="description" className="text-xs">
                    Description
                  </Label>
                  <Input
                    id="description"
                    placeholder="e.g. para kay Aling Nena"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-0 pt-4">
        <div>
          <p className="text-sm text-muted-foreground">Income</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(feeNum)}
          </p>
        </div>
        <Button
          type="button"
          onClick={handleAdd}
          disabled={
            amountMissing ||
            (isPerUnit && feeNum <= 0) ||
            feeExceedsAmount ||
            paymentMismatch
          }
        >
          Add to sale
        </Button>
      </DrawerFooter>
    </div>
  );
}
