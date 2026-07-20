"use client";

import { useActionState, useState } from "react";
import { WalletIcon } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
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
  MONEY_ACCOUNTS,
  MONEY_ACCOUNT_LABELS,
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

/**
 * Lives inside DrawerContent so it unmounts on close — quantities, selection
 * and the action state all reset for the next customer, same as the sale
 * drawer.
 */
function ServiceSaleForm({ services }: { services: Service[] }) {
  const [selected, setSelected] = useState<Service | null>(null);
  const [principal, setPrincipal] = useState("");
  const [fee, setFee] = useState("");
  const [paymentAccount, setPaymentAccount] = useState<MoneyAccount>("cash");
  const [tendered, setTendered] = useState("");
  const [state, formAction, isPending] = useActionState(
    recordServiceSale,
    initialState
  );

  const principalNum = toNumber(principal);
  const feeNum = toNumber(fee);

  function pick(service: Service) {
    setSelected(service);
    // Each service brings its own default fee; still editable below.
    setFee(service.default_fee !== null ? String(service.default_fee) : "");
  }

  const payLabel = MONEY_ACCOUNT_LABELS[paymentAccount];

  // Change calculator applies only when physical cash is handed over:
  // a cash-in service paid via the cash box. Due = principal + fee.
  const showTendered =
    selected?.cash_flow === "in" && paymentAccount === "cash";
  const due = principalNum + feeNum;
  const insufficient = showTendered && isShort(tendered, due);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4">
      <input type="hidden" name="service_id" value={selected?.id ?? ""} />
      <input type="hidden" name="payment_account" value={paymentAccount} />

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {services.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            No services set up yet. Add them under Inventory → Services.
          </p>
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
                  {service.default_fee !== null
                    ? ` · usual fee ${formatPeso(Number(service.default_fee))}`
                    : null}
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
              <Label htmlFor="principal">Amount</Label>
              <Input
                id="principal"
                name="principal"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={principal}
                onChange={(event) => setPrincipal(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fee">Fee (your income)</Label>
              <Input
                id="fee"
                name="fee"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>
              {selected.cash_flow === "in"
                ? "Customer pays via"
                : "Paid out from"}
            </Label>
            <Tabs
              value={paymentAccount}
              onValueChange={(value) =>
                setPaymentAccount(value as MoneyAccount)
              }
              className="w-full min-w-0"
            >
              <TabsList className="w-full sm:w-fit">
                {MONEY_ACCOUNTS.map((account) => (
                  <TabsTrigger key={account} value={account}>
                    {MONEY_ACCOUNT_LABELS[account]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <p
            className="text-sm text-muted-foreground"
            data-testid="box-effect"
          >
            {selected.cash_flow === "in"
              ? `Adds ${formatPeso(principalNum + feeNum)} to ${payLabel}` +
                (selected.wallet
                  ? ` · sends ${formatPeso(principalNum)} from ${MONEY_ACCOUNT_LABELS[selected.wallet]}.`
                  : ".")
              : `Takes ${formatPeso(principalNum)} from ${payLabel}` +
                (selected.wallet
                  ? ` · ${formatPeso(principalNum + feeNum)} arrives in ${MONEY_ACCOUNT_LABELS[selected.wallet]}.`
                  : ".")}
          </p>

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
                      <Label htmlFor="contact_number">Number</Label>
                      <Input
                        id="contact_number"
                        name="contact_number"
                        inputMode="tel"
                        placeholder="e.g. 09171234567"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="reference">Reference no.</Label>
                      <Input
                        id="reference"
                        name="reference"
                        placeholder="From the app"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="description">Description</Label>
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
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Done
          </DrawerClose>
        </div>
      ) : null}

      <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t pt-4">
        <div>
          <p className="text-sm text-muted-foreground">Income</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(feeNum)}
          </p>
        </div>
        <Button
          type="submit"
          disabled={
            isPending || !selected || principalNum + feeNum <= 0 || insufficient
          }
        >
          {isPending ? "Recording…" : "Record"}
        </Button>
      </div>
    </form>
  );
}

export default function ServiceDrawer({ services }: { services: Service[] }) {
  return (
    <Drawer showSwipeHandle>
      {/* Header placement — tablet and up */}
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: "outline" }),
          "hidden sm:inline-flex"
        )}
      >
        Service
      </DrawerTrigger>

      {/* Floating pill on phones, paired with New sale: this one ends just
          left of the screen's centreline, New sale starts just right of it. */}
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: "outline" }),
          "fixed right-1/2 z-50 mr-1 sm:hidden",
          "bottom-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "h-12 rounded-full bg-background px-5 text-base shadow-lg"
        )}
      >
        <WalletIcon data-icon="inline-start" />
        Service
      </DrawerTrigger>

      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Record a service</DrawerTitle>
          <DrawerDescription>
            Only the fee counts as income — the amount passes through.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ServiceSaleForm services={services} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
