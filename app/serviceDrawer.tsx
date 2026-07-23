"use client";

import { useActionState, useState } from "react";
import { WalletIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  feeForPrincipal,
  MONEY_ACCOUNTS,
  MONEY_ACCOUNT_LABELS,
  parseFeeTiers,
  type MoneyAccount,
  type Service,
} from "@/lib/types";
import ChangeCalculator, { isShort } from "./changeCalculator";
import { recordServiceSale, type ServiceSaleState } from "./services/actions";

const initialState: ServiceSaleState = { error: null };

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Tier-matched fee for the amount, falling back to the service's flat
    default_fee when no tier covers it (or none are configured at all). */
function resolveFee(service: Service, principal: number): number | null {
  const tierFee = feeForPrincipal(parseFeeTiers(service.fee_tiers), principal);
  if (tierFee !== null) return tierFee;
  return service.default_fee !== null ? Number(service.default_fee) : null;
}

/**
 * Lives inside DrawerContent so it unmounts on close — quantities, selection
 * and the action state all reset for the next customer, same as the sale
 * drawer.
 */
function ServiceSaleForm({
  services,
  balances,
}: {
  services: Service[];
  /** Current vault balance per account — used to warn when a cash-in
      service tied to a wallet (e.g. GCash Load) would draw the wallet
      below zero; the wallet itself can't front money it doesn't have. */
  balances: Map<MoneyAccount, number>;
}) {
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
  const [paymentAccount, setPaymentAccount] = useState<MoneyAccount>("cash");
  const [tendered, setTendered] = useState("");
  const [state, formAction, isPending] = useActionState(
    recordServiceSale,
    initialState
  );

  const principalNum = toNumber(principal);
  const feeNum = toNumber(fee);
  const hasWallet = Boolean(selected?.wallet);
  const isCashOut = selected?.cash_flow === "out";
  // Cash-in only — what actually moves through the wallet once the
  // fee-included-in-amount adjustment is applied. The server re-derives
  // this itself rather than trusting this client-side number; this is
  // preview only. Cash-out never adjusts principal on the client: the full
  // typed Amount is submitted as-is, and record_service() itself splits the
  // fee into its own ledger line (see box-effect text below for the cash-out
  // preview of that split).
  const cashInEffectivePrincipal = deductFee
    ? Math.max(0, principalNum - feeNum)
    : principalNum;
  const feeExceedsAmount = deductFee && feeNum > principalNum;

  const tiers = selected ? parseFeeTiers(selected.fee_tiers) : [];
  const matchedTier =
    tiers.length > 0
      ? (tiers.find(
          (t) => principalNum >= t.min && (t.max === null || principalNum <= t.max)
        ) ?? null)
      : null;

  function pick(service: Service) {
    setSelected(service);
    setFeeTouched(false);
    setDeductFee(false);
    setFeeInWallet(false);
    // Each service brings its own default fee (or a tier match against
    // whatever amount is already typed); still editable below.
    const resolved = resolveFee(service, toNumber(principal));
    setFee(resolved !== null ? String(resolved) : "");
    // Switching services can change which accounts are even valid — jump to
    // that service's first allowed one rather than leaving a stale, now
    // disallowed, selection in place.
    setPaymentAccount(service.allowed_payment_accounts[0] ?? "cash");
  }

  const payLabel = MONEY_ACCOUNT_LABELS[paymentAccount];
  const allowedAccounts = selected?.allowed_payment_accounts ?? ["cash"];

  // Change calculator applies only when physical cash is handed over:
  // a cash-in service paid via the cash box. Due = effective principal + fee
  // — with the deduct-fee adjustment applied, that's exactly the raw typed
  // Amount again (the fee comes out of the wallet side, not the cash due).
  const showTendered =
    selected?.cash_flow === "in" && paymentAccount === "cash";
  const due = cashInEffectivePrincipal + feeNum;
  const insufficient = showTendered && isShort(tendered, due);

  // A cash-in service tied to a wallet (e.g. GCash Load) sends the effective
  // principal OUT of that wallet to the customer — it can't send more than
  // the wallet actually holds. Flagged, not blocked: the tracked balance can
  // lag the real one (e.g. a top-up done outside the app), so this warns and
  // lets the cashier confirm rather than hard-stopping a transaction that
  // may be perfectly fine in reality. Cash-out never draws the wallet down,
  // it adds to it, so this check only ever applies to cash-in.
  const walletBalance =
    selected?.wallet !== undefined && selected?.wallet !== null
      ? (balances.get(selected.wallet) ?? 0)
      : null;
  const walletShort =
    selected?.cash_flow === "in" &&
    walletBalance !== null &&
    cashInEffectivePrincipal > walletBalance;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!walletShort || !selected?.wallet) return;
        const label = MONEY_ACCOUNT_LABELS[selected.wallet];
        if (
          !confirm(
            `This sends ${formatPeso(cashInEffectivePrincipal)} from ${label}, but its tracked balance is only ${formatPeso(walletBalance ?? 0)}.\n\nRecord anyway?`
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <input type="hidden" name="service_id" value={selected?.id ?? ""} />
      <input type="hidden" name="payment_account" value={paymentAccount} />
      <input type="hidden" name="deduct_fee" value={deductFee ? "on" : ""} />
      <input type="hidden" name="fee_in_wallet" value={feeInWallet ? "on" : ""} />

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {services.length === 0 ? (
          <EmptyState
            title="No services set up yet."
            subtitle="Add them under Inventory → Services."
          />
        ) : (
          services.map((service) => (
            <button
              key={service.id}
              type="button"
              aria-label={`Choose ${service.name}`}
              aria-pressed={selected?.id === service.id}
              onClick={() => pick(service)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                selected?.id === service.id && "border-ring ring-2 ring-ring/40"
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{service.name}</p>
                <p className="text-xs text-muted-foreground">
                  {service.cash_flow === "in"
                    ? "Customer pays in"
                    : "You pay out"}
                  {service.wallet
                    ? ` · ${MONEY_ACCOUNT_LABELS[service.wallet]} wallet`
                    : null}
                  {parseFeeTiers(service.fee_tiers).length > 0
                    ? " · tiered fee"
                    : service.default_fee !== null
                      ? ` · usual fee ${formatPeso(Number(service.default_fee))}`
                      : null}
                  {" · "}
                  {service.allowed_payment_accounts
                    .map((account) => MONEY_ACCOUNT_LABELS[account])
                    .join(", ")}
                </p>
              </div>
            </button>
          ))
        )}
      </div>

      {selected ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="principal" className="text-xs">
                Amount
              </Label>
              <Input
                id="principal"
                name="principal"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={principal}
                onChange={(event) => {
                  const value = event.target.value;
                  setPrincipal(value);
                  // Tiered services only — untiered ones never had the fee
                  // react to the amount, and that stays true here.
                  if (selected && !feeTouched && tiers.length > 0) {
                    const resolved = resolveFee(selected, toNumber(value));
                    if (resolved !== null) setFee(String(resolved));
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fee" className="text-xs">
                Fee (your income)
              </Label>
              <Input
                id="fee"
                name="fee"
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

          {tiers.length > 0 ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              {matchedTier ? (
                <>
                  {formatPeso(matchedTier.min)}–
                  {matchedTier.max !== null ? formatPeso(matchedTier.max) : "up"}
                  {" → "}
                  <span className="font-medium text-foreground">
                    {formatPeso(matchedTier.fee)}
                  </span>
                  {!feeTouched ? " — filled in above, adjust if you like." : null}
                </>
              ) : (
                "No tier matches this amount — check the fee."
              )}
            </p>
          ) : null}

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
                Fee is added to the {MONEY_ACCOUNT_LABELS[selected.wallet]}{" "}
                amount instead of cash
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
            {allowedAccounts.length > 1 ? (
              <Tabs
                value={paymentAccount}
                onValueChange={(value) =>
                  setPaymentAccount(value as MoneyAccount)
                }
                className="w-full min-w-0"
              >
                <TabsList className="w-full sm:w-fit">
                  {MONEY_ACCOUNTS.filter((account) =>
                    allowedAccounts.includes(account)
                  ).map((account) => (
                    <TabsTrigger key={account} value={account}>
                      {MONEY_ACCOUNT_LABELS[account]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              // Only one method is valid for this service — nothing to
              // choose. State stays; no interactive control needed.
              <p className="text-sm">{payLabel}</p>
            )}
          </div>

          <p
            className="text-sm text-muted-foreground"
            data-testid="box-effect"
          >
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

          {showTendered ? (
            <ChangeCalculator due={due} value={tendered} onChange={setTendered} />
          ) : null}

          {/* Collapsed by default: the fast path stays two taps. keepMounted
              is required — without it base-ui unmounts the collapsed panel,
              and details typed then collapsed would silently not submit. */}
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
                        name="contact_number"
                        inputMode="tel"
                        placeholder="e.g. 09171234567"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="reference" className="text-xs">
                        Reference no.
                      </Label>
                      <Input
                        id="reference"
                        name="reference"
                        placeholder="From the app"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="description" className="text-xs">
                      Description
                    </Label>
                    <Input
                      id="description"
                      name="description"
                      placeholder="e.g. para kay Aling Nena"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a service to continue.
        </p>
      )}

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state.recordedId ? (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span>Service recorded.</span>
          <DrawerClose
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Done
          </DrawerClose>
        </div>
      ) : null}

      <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-0 pt-4">
        <div>
          <p className="text-sm text-muted-foreground">Income</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(feeNum)}
          </p>
        </div>
        <Button
          type="submit"
          disabled={
            isPending ||
            !selected ||
            principalNum + feeNum <= 0 ||
            insufficient ||
            feeExceedsAmount
          }
        >
          {isPending ? "Recording…" : "Record"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

export default function ServiceDrawer({
  services,
  balances,
}: {
  services: Service[];
  balances: Map<MoneyAccount, number>;
}) {
  return (
    <Drawer showSwipeHandle>
      {/* Header placement — tablet and up */}
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: "outline" }),
          "hidden sm:inline-flex"
        )}
      >
        E-Services
      </DrawerTrigger>

      {/* Floating pill on phones, paired with New sale: this one ends just
          left of the screen's centreline, New sale starts just right of it. */}
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: "outline" }),
          "fixed right-1/2 z-50 mr-1 sm:hidden",
          "bottom-[calc(1.5rem+env(safe-area-inset-bottom)+var(--bottom-nav-h))]",
          "h-12 rounded-full bg-background px-5 text-base shadow-lg"
        )}
      >
        <WalletIcon data-icon="inline-start" />
        E-Services
      </DrawerTrigger>

      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Record a service</DrawerTitle>
          <DrawerDescription>
            Only the fee counts as income — the amount passes through.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ServiceSaleForm services={services} balances={balances} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
