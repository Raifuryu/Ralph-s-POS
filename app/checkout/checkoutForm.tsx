"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";

import { EmptyState } from "@/components/emptyState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type MoneyAccount,
  type PaymentMethod,
  type Product,
  type Service
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { isShort } from "../changeCalculator";
import { recordVisit, type VisitState } from "./actions";
import ItemPickerDrawer from "./itemPickerDrawer";
import ServicePickerDrawer from "./servicePickerDrawer";
import type { ServiceDraft } from "./serviceLineEditor";

const initialState: VisitState = { error: null };

/** Same parsing ChangeCalculator uses — duplicated locally rather than
    exported from there, since this drawer is the only place that needs the
    "Customer gave" input and its change/short readout positioned apart from
    each other (beside the payment method tabs vs. down in the footer) rather
    than stacked together the way ChangeCalculator renders them everywhere
    else (e.g. the service drawer). */
function toAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type AdjustmentMode = "peso" | "percent";
// "discount" takes off, "surcharge" adds on top — the inverse of each
// other, sharing the same peso/percent editor.
type AdjustmentKind = "discount" | "surcharge";
type AdjustmentDraft = { kind: AdjustmentKind; mode: AdjustmentMode; value: string };

/** Converts whatever the cashier typed (pesos, or a percent of the line's
    own subtotal) into a single SIGNED peso delta — negative for a discount
    (taken off, clamped so a line can never go negative), positive for a
    surcharge (added on top, no natural cap). Recomputed on every render
    rather than stored, so a percent adjustment automatically tracks
    quantity changes instead of going stale. */
function adjustmentDeltaFor(
  draft: AdjustmentDraft | undefined,
  subtotal: number
): number {
  if (!draft) return 0;
  const raw = toAmount(draft.value);
  if (raw === null || raw <= 0) return 0;
  const pesos = draft.mode === "percent" ? (subtotal * raw) / 100 : raw;
  return draft.kind === "discount" ? -Math.min(pesos, subtotal) : pesos;
}

// Versioned so a future change to this shape can't misread an old draft
// left over from before a deploy. Bumped to v2 when discountDrafts grew a
// `kind` field and became adjustmentDrafts.
const DRAFT_STORAGE_KEY = "ralph-pos:sale-draft:v2";

type SaleDraft = {
  quantities: Record<string, number>;
  adjustmentDrafts: Record<string, AdjustmentDraft>;
  serviceDrafts: ServiceDraft[];
  paymentMethod: PaymentMethod;
  tendered: string;
  personalTake: boolean;
};

export default function CheckoutForm({
  products,
  topProductIds,
  services,
  balances,
  doneSlot,
  onRecorded
}: {
  products: Product[];
  /** Product ids ranked by units sold, best first. Shown as quick picks. */
  topProductIds?: string[];
  services: Service[];
  /** Current vault balance per account — passed through to the service
      editor for its wallet-short warning. */
  balances: Map<MoneyAccount, number>;
  /**
   * Rendered after a successful sale. Defaults to a link back to the
   * dashboard; the drawer passes a close button instead.
   */
  doneSlot?: React.ReactNode;
  /** Called shortly after a successful sale — the drawer closes itself
      instead of waiting on doneSlot's button. Omitted on the standalone
      /checkout page, which has no sheet to close. */
  onRecorded?: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Per product id -- tap a line in "In this sale" to expand its own
  // discount/surcharge editor. Independent per line: adjusting the Coke
  // never touches the Ice sitting right below it.
  const [adjustmentDrafts, setAdjustmentDrafts] = useState<
    Record<string, AdjustmentDraft>
  >({});
  const [expandedDiscountId, setExpandedDiscountId] = useState<string | null>(
    null
  );
  // E-services added alongside the product cart — configured in their own
  // sheet (ServicePickerDrawer) and added here as drafts; nothing hits the
  // server until the whole sale, cart and services together, is recorded
  // atomically (see migration 0031's record_visit()).
  const [serviceDrafts, setServiceDrafts] = useState<ServiceDraft[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  // Stock still leaves the shelf, but nothing was sold — no payment method,
  // no change to tender, no income. See app/checkout/actions.ts.
  const [personalTake, setPersonalTake] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [state, formAction, isPending] = useActionState(
    recordVisit,
    initialState
  );

  // Brief delay so "Sale recorded." is actually readable before the sheet
  // closes — an instant close would make the confirmation flash by unseen.
  useEffect(() => {
    if (!state.visitId || !onRecorded) return;
    const timer = setTimeout(onRecorded, 700);
    return () => clearTimeout(timer);
  }, [state.visitId, onRecorded]);

  // Restores an in-progress sale after the sheet is closed and reopened (or
  // the page is refreshed) — sessionStorage survives that; component state
  // doesn't once NewSaleDrawer unmounts its contents on close. Scoped to the
  // browser tab's session rather than saved indefinitely, so a draft from a
  // previous day never resurfaces.
  //
  // Deliberately setState-in-effect: sessionStorage doesn't exist during
  // SSR, so the initial render (server AND the first client render, which
  // must match it for hydration) always renders the plain default. Reading
  // the real draft has to happen after hydration completes, in an effect —
  // reading it any earlier (e.g. a lazy useState initializer) would make the
  // first client render diverge from the server-rendered HTML.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<SaleDraft>;
        if (draft.quantities && typeof draft.quantities === "object") {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setQuantities(draft.quantities);
        }
        if (
          draft.adjustmentDrafts &&
          typeof draft.adjustmentDrafts === "object"
        ) {
          setAdjustmentDrafts(draft.adjustmentDrafts);
        }
        if (Array.isArray(draft.serviceDrafts)) {
          setServiceDrafts(draft.serviceDrafts);
        }
        if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
        if (typeof draft.tendered === "string") setTendered(draft.tendered);
        if (typeof draft.personalTake === "boolean") {
          setPersonalTake(draft.personalTake);
        }
      }
    } catch {
      // Corrupt or inaccessible storage — start with a blank sale rather
      // than crash the sheet.
    }
    setHydrated(true);
  }, []);

  // Persists once hydration has settled, never before — writing on the very
  // first render (still showing blank defaults) would stomp a real draft
  // with emptiness before it's had a chance to load.
  useEffect(() => {
    if (!hydrated) return;
    try {
      const draft: SaleDraft = {
        quantities,
        adjustmentDrafts,
        serviceDrafts,
        paymentMethod,
        tendered,
        personalTake
      };
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Storage full/unavailable — the draft just won't survive a close,
      // not fatal to the sale itself.
    }
  }, [
    hydrated,
    quantities,
    adjustmentDrafts,
    serviceDrafts,
    paymentMethod,
    tendered,
    personalTake
  ]);

  // A recorded sale is done being a "draft" — clear it immediately so it
  // can't resurface on the next mount. In-memory state doesn't need
  // resetting here: the drawer unmounts on close (see NewSaleDrawer).
  useEffect(() => {
    if (!state.visitId) return;
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [state.visitId]);

  function resetDraft() {
    setQuantities({});
    setAdjustmentDrafts({});
    setExpandedDiscountId(null);
    setServiceDrafts([]);
    setPaymentMethod("cash");
    setTendered("");
    setPersonalTake(false);
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function removeServiceDraft(key: string) {
    setServiceDrafts((prev) => prev.filter((draft) => draft.key !== key));
    // Same cleanup setQuantity does for a removed product line — a
    // service re-added later should start over, not resurrect a stale
    // adjustment from a completely different line that happened to reuse
    // this expanded/discount state.
    setAdjustmentDrafts((prev) => {
      if (!(key in prev)) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    setExpandedDiscountId((cur) => (cur === key ? null : cur));
  }

  // Per-unit services act like a product line once added — quantity can be
  // adjusted right here instead of removing and re-adding. Flat/tiered
  // drafts have no quantity concept (dropping to 0 removes the line, same
  // as a product's own quantity stepper).
  function setServiceDraftQuantity(key: string, quantity: number) {
    const nextQuantity = Math.max(0, quantity);
    if (nextQuantity <= 0) {
      removeServiceDraft(key);
      return;
    }
    setServiceDrafts((prev) =>
      prev.map((draft) =>
        draft.key === key && draft.unitPrice !== null
          ? {
              ...draft,
              unitQuantity: nextQuantity,
              fee: draft.unitPrice * nextQuantity
            }
          : draft
      )
    );
  }

  // The cart is built from ALL products, not the filtered view — searching
  // must never silently drop items already added.
  const cart = useMemo(
    () =>
      products
        .map((product) => {
          const quantity = quantities[product.id] ?? 0;
          const subtotal = Number(product.price) * quantity;
          const delta = adjustmentDeltaFor(adjustmentDrafts[product.id], subtotal);
          const discount = delta < 0 ? -delta : 0;
          const surcharge = delta > 0 ? delta : 0;
          return { product, quantity, subtotal, discount, surcharge };
        })
        .filter((line) => line.quantity > 0),
    [products, quantities, adjustmentDrafts]
  );

  // Lines selling more than the recorded stock. Allowed — the shelf is the
  // source of truth, not the system — but flagged and confirmed, and the
  // stock goes negative as the signal to recount.
  const oversoldLines = cart.filter(
    (line) => line.product.stock !== null && line.quantity > line.product.stock
  );

  // Display only. The authoritative total is computed by the database.
  const previewTotal = cart.reduce(
    (sum, line) => sum + (line.subtotal + line.surcharge - line.discount),
    0
  );
  const totalDiscount = cart.reduce((sum, line) => sum + line.discount, 0);
  const totalSurcharge = cart.reduce((sum, line) => sum + line.surcharge, 0);
  const pieceCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  // Discount/surcharge only apply to a per-unit service line (it acts like
  // a product line once added — see the render below); a flat/tiered
  // draft's fee is exactly what was typed when it was configured.
  // adjustmentDrafts is shared with the product cart above — draft.key and
  // a product id are both effectively-random UUIDs from different sources,
  // so there's no realistic collision between the two.
  const serviceLines = useMemo(
    () =>
      serviceDrafts.map((draft) => {
        const delta =
          draft.unitLabel !== null
            ? adjustmentDeltaFor(adjustmentDrafts[draft.key], draft.fee)
            : 0;
        const discount = delta < 0 ? -delta : 0;
        const surcharge = delta > 0 ? delta : 0;
        return { draft, discount, surcharge, netFee: draft.fee + delta };
      }),
    [serviceDrafts, adjustmentDrafts]
  );

  const serviceFeesTotal = serviceLines.reduce(
    (sum, { netFee }) => sum + netFee,
    0
  );
  // Each service line's net cash impact on the sale's single combined total
  // — the same signed amount its own box-effect preview described when it
  // was added. Cash-in adds (the customer hands this much over); cash-out
  // subtracts (the store hands cash back out), mirroring how a cash-out
  // line already nets against the till on its own.
  const serviceLinesTotal = serviceLines.reduce((sum, { draft, netFee }) => {
    if (draft.cashFlow === "in") {
      return (
        sum + (draft.deductFee ? draft.principal : draft.principal + netFee)
      );
    }
    return (
      sum - (draft.feeInWallet ? draft.principal : draft.principal - netFee)
    );
  }, 0);
  // The sale's single combined total — cart plus every service line, all
  // collected/paid via the one payment method below. A personal take never
  // has a payment for the cart portion, so that part drops out here (any
  // services alongside it still count normally).
  const grandTotal = (personalTake ? 0 : previewTotal) + serviceLinesTotal;

  // A personal take's cart needs no payment; a service line always does,
  // regardless of personalTake (that flag only concerns the cart).
  const showPaymentSection =
    (cart.length > 0 && !personalTake) || serviceDrafts.length > 0;

  const insufficient =
    showPaymentSection &&
    paymentMethod === "cash" &&
    isShort(tendered, grandTotal);
  const tenderedAmount = toAmount(tendered);

  function setQuantity(id: string, next: number) {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, next) }));
    // Removing a line clears its adjustment too — re-adding the same
    // product later should start over, not resurrect a stale markdown.
    if (next <= 0) {
      setAdjustmentDrafts((prev) => {
        if (!(id in prev)) return prev;
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setExpandedDiscountId((cur) => (cur === id ? null : cur));
    }
  }

  if (products.length === 0 && services.length === 0) {
    return (
      <EmptyState
        title="Nothing to sell yet."
        subtitle="Add products or services in Inventory first, then come back."
        action={
          <Link href="/inventory" className="text-sm underline">
            Go to Inventory
          </Link>
        }
      />
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (oversoldLines.length === 0) return;
        const detail = oversoldLines
          .map(
            (line) =>
              `${line.product.name}: selling ${line.quantity}, only ${line.product.stock} in stock`
          )
          .join("\n");
        const noun = personalTake ? "take" : "sale";
        if (
          !confirm(
            `This ${noun} exceeds recorded stock:\n\n${detail}\n\nRecord anyway? Stock will go negative so you can recount later.`
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <input
        type="hidden"
        name="cart"
        value={JSON.stringify(
          cart.map((line) => ({
            product_id: line.product.id,
            quantity: line.quantity,
            discount_amount: line.discount,
            surcharge_amount: line.surcharge
          }))
        )}
      />
      <input
        type="hidden"
        name="services"
        value={JSON.stringify(
          serviceLines.map(({ draft, netFee, discount, surcharge }) => ({
            service_id: draft.serviceId,
            principal: draft.principal,
            // The server derives the real fee itself for a per-unit line
            // (unit_price x quantity + surcharge_amount - discount_amount),
            // same reasoning checkout() never trusts a client-submitted
            // price — this is just what the sheet is already showing, not
            // the source of truth.
            fee: netFee,
            discount_amount: discount,
            surcharge_amount: surcharge,
            // The sale's one combined payment method, same as the cart —
            // no longer chosen per service line.
            payment_account: paymentMethod,
            deduct_fee: draft.deductFee,
            fee_in_wallet: draft.feeInWallet,
            unit_label: draft.unitLabel,
            unit_quantity: draft.unitQuantity,
            unit_price: draft.unitPrice,
            contact_number: draft.contactNumber,
            reference: draft.reference,
            description: draft.description
          }))
        )}
      />
      {/* Omitted entirely (not just disabled) for a personal take, so
          formData.get("payment_method") comes back null server-side. */}
      {!personalTake ? (
        <input type="hidden" name="payment_method" value={paymentMethod} />
      ) : null}

      {/* Each opens its own full-height sheet — keeps browsing/configuring
          from being squeezed out by the cart, payment method, and change
          calculator below, which all need their own fixed space regardless
          of how many lines are in the sale. Quantities are edited in "In
          this sale" below, not in either picker. */}
      <div className="grid grid-cols-2 gap-2">
        <ItemPickerDrawer
          products={products}
          topProductIds={topProductIds}
          quantities={quantities}
          onAdd={(id) => setQuantity(id, (quantities[id] ?? 0) + 1)}
          pieceCount={pieceCount}
        />
        <ServicePickerDrawer
          services={services}
          balances={balances}
          paymentMethod={paymentMethod}
          drafts={serviceDrafts}
          onAdd={(draft) => setServiceDrafts((prev) => [...prev, draft])}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">In this sale</p>
          {cart.length > 0 ||
          serviceDrafts.length > 0 ||
          personalTake ||
          tendered !== "" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Clear this sale and start over?")) resetDraft();
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
        {cart.length === 0 && serviceDrafts.length === 0 ? (
          <EmptyState
            title="No items yet."
            subtitle="Tap “Add items” or “Add service” above to get started."
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {cart.map((line) => {
              const oversold =
                line.product.stock !== null &&
                line.quantity > line.product.stock;
              const isExpanded = expandedDiscountId === line.product.id;
              const draft = adjustmentDrafts[line.product.id];
              const hasDiscount = line.discount > 0;
              const hasSurcharge = line.surcharge > 0;
              const lineTotal = line.subtotal + line.surcharge - line.discount;
              return (
                <div
                  key={line.product.id}
                  data-oversold={oversold || undefined}
                  className={cn(
                    "flex justify-between gap-2",
                    isExpanded ? "items-start" : "items-center",
                    oversold &&
                      "rounded-lg border border-warning/60 bg-warning/10 p-2"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {/* Tapping the name/price toggles this line's discount/
                      surcharge editor below — kept as its own button,
                      separate from the quantity controls to the right, so a
                      mis-tap can't accidentally change how many are being
                      sold. */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedDiscountId((cur) =>
                          cur === line.product.id ? null : line.product.id
                        )
                      }
                      aria-expanded={isExpanded}
                      aria-label={`${hasDiscount || hasSurcharge ? "Edit" : "Add"} discount or surcharge for ${line.product.name}`}
                      className="block w-full min-w-0 text-left"
                    >
                      <p className="truncate text-sm">{line.product.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatPeso(Number(line.product.price))} ×{" "}
                        {line.quantity}
                        {hasDiscount ? (
                          <>
                            {" − "}
                            {formatPeso(line.discount)}
                            {" = "}
                            <span className="font-medium text-foreground">
                              {formatPeso(lineTotal)}
                            </span>
                          </>
                        ) : hasSurcharge ? (
                          <>
                            {" + "}
                            {formatPeso(line.surcharge)}
                            {" = "}
                            <span className="font-medium text-foreground">
                              {formatPeso(lineTotal)}
                            </span>
                          </>
                        ) : (
                          <> = {formatPeso(lineTotal)}</>
                        )}
                      </p>
                      {oversold ? (
                        <p className="text-xs font-medium text-warning">
                          Only {line.product.stock} in stock — will drop to{" "}
                          {line.product.stock! - line.quantity}
                        </p>
                      ) : null}
                    </button>

                    {isExpanded ? (
                      <div className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-2">
                        <Tabs
                          value={draft?.kind ?? "discount"}
                          onValueChange={(value) =>
                            setAdjustmentDrafts((prev) => ({
                              ...prev,
                              [line.product.id]: {
                                kind: value as AdjustmentKind,
                                mode: prev[line.product.id]?.mode ?? "peso",
                                value: prev[line.product.id]?.value ?? ""
                              }
                            }))
                          }
                        >
                          <TabsList className="w-full">
                            <TabsTrigger value="discount" className="flex-1">
                              Discount
                            </TabsTrigger>
                            <TabsTrigger value="surcharge" className="flex-1">
                              Add charge
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <div className="flex items-center gap-2">
                          <Tabs
                            value={draft?.mode ?? "peso"}
                            onValueChange={(value) =>
                              setAdjustmentDrafts((prev) => ({
                                ...prev,
                                [line.product.id]: {
                                  kind: prev[line.product.id]?.kind ?? "discount",
                                  mode: value as AdjustmentMode,
                                  value: prev[line.product.id]?.value ?? ""
                                }
                              }))
                            }
                          >
                            <TabsList>
                              <TabsTrigger value="peso">₱</TabsTrigger>
                              <TabsTrigger value="percent">%</TabsTrigger>
                            </TabsList>
                          </Tabs>
                          <Input
                            aria-label={`${draft?.kind === "surcharge" ? "Surcharge" : "Discount"} amount for ${line.product.name}`}
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder="0"
                            className="w-20"
                            value={draft?.value ?? ""}
                            onChange={(event) =>
                              setAdjustmentDrafts((prev) => ({
                                ...prev,
                                [line.product.id]: {
                                  kind: prev[line.product.id]?.kind ?? "discount",
                                  mode: prev[line.product.id]?.mode ?? "peso",
                                  value: event.target.value
                                }
                              }))
                            }
                          />
                          {draft?.value ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setAdjustmentDrafts((prev) => {
                                  const copy = { ...prev };
                                  delete copy[line.product.id];
                                  return copy;
                                })
                              }
                            >
                              Clear
                            </Button>
                          ) : null}
                        </div>
                        {hasDiscount || hasSurcharge ? (
                          <p className="text-xs text-muted-foreground">
                            New line total:{" "}
                            <span className="font-medium text-foreground">
                              {formatPeso(lineTotal)}
                            </span>{" "}
                            ({hasDiscount ? "−" : "+"}
                            {formatPeso(hasDiscount ? line.discount : line.surcharge)})
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Remove one ${line.product.name}`}
                      onClick={() =>
                        setQuantity(line.product.id, line.quantity - 1)
                      }
                    >
                      <MinusIcon />
                    </Button>
                    <Input
                      aria-label={`Quantity of ${line.product.name}`}
                      inputMode="numeric"
                      className="w-12 text-center"
                      value={line.quantity}
                      onChange={(event) =>
                        setQuantity(
                          line.product.id,
                          Number.parseInt(event.target.value, 10) || 0
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Add one ${line.product.name}`}
                      onClick={() =>
                        setQuantity(line.product.id, line.quantity + 1)
                      }
                    >
                      <PlusIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${line.product.name} from sale`}
                      onClick={() => setQuantity(line.product.id, 0)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
              );
            })}

            {serviceLines.map(({ draft, discount, surcharge, netFee }) => {
              // Flat/tiered: unchanged simple row -- Amount and Fee were
              // typed directly when it was configured, there's no quantity
              // or discount concept to attach here.
              if (draft.unitLabel === null) {
                return (
                  <div
                    key={draft.key}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{draft.label}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatPeso(draft.principal)} · fee{" "}
                        {formatPeso(draft.fee)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${draft.label} from sale`}
                      onClick={() => removeServiceDraft(draft.key)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                );
              }

              // Per-unit: acts like a product line -- its own quantity
              // stepper and discount/surcharge editor, same pattern as the
              // cart above.
              const isExpanded = expandedDiscountId === draft.key;
              const adjustmentDraft = adjustmentDrafts[draft.key];
              const hasDiscount = discount > 0;
              const hasSurcharge = surcharge > 0;
              const quantity = draft.unitQuantity ?? 0;
              return (
                <div
                  key={draft.key}
                  className={cn(
                    "flex justify-between gap-2",
                    isExpanded ? "items-start" : "items-center"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedDiscountId((cur) =>
                          cur === draft.key ? null : draft.key
                        )
                      }
                      aria-expanded={isExpanded}
                      aria-label={`${hasDiscount || hasSurcharge ? "Edit" : "Add"} discount or surcharge for ${draft.label}`}
                      className="block w-full min-w-0 text-left"
                    >
                      <p className="truncate text-sm">{draft.label}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {quantity} × {draft.unitLabel} @{" "}
                        {formatPeso(draft.unitPrice ?? 0)}
                        {hasDiscount ? (
                          <>
                            {" − "}
                            {formatPeso(discount)}
                            {" = "}
                            <span className="font-medium text-foreground">
                              {formatPeso(netFee)}
                            </span>
                          </>
                        ) : hasSurcharge ? (
                          <>
                            {" + "}
                            {formatPeso(surcharge)}
                            {" = "}
                            <span className="font-medium text-foreground">
                              {formatPeso(netFee)}
                            </span>
                          </>
                        ) : (
                          <> = {formatPeso(netFee)}</>
                        )}
                      </p>
                    </button>

                    {isExpanded ? (
                      <div className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-2">
                        <Tabs
                          value={adjustmentDraft?.kind ?? "discount"}
                          onValueChange={(value) =>
                            setAdjustmentDrafts((prev) => ({
                              ...prev,
                              [draft.key]: {
                                kind: value as AdjustmentKind,
                                mode: prev[draft.key]?.mode ?? "peso",
                                value: prev[draft.key]?.value ?? ""
                              }
                            }))
                          }
                        >
                          <TabsList className="w-full">
                            <TabsTrigger value="discount" className="flex-1">
                              Discount
                            </TabsTrigger>
                            <TabsTrigger value="surcharge" className="flex-1">
                              Add charge
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <div className="flex items-center gap-2">
                          <Tabs
                            value={adjustmentDraft?.mode ?? "peso"}
                            onValueChange={(value) =>
                              setAdjustmentDrafts((prev) => ({
                                ...prev,
                                [draft.key]: {
                                  kind: prev[draft.key]?.kind ?? "discount",
                                  mode: value as AdjustmentMode,
                                  value: prev[draft.key]?.value ?? ""
                                }
                              }))
                            }
                          >
                            <TabsList>
                              <TabsTrigger value="peso">₱</TabsTrigger>
                              <TabsTrigger value="percent">%</TabsTrigger>
                            </TabsList>
                          </Tabs>
                          <Input
                            aria-label={`${adjustmentDraft?.kind === "surcharge" ? "Surcharge" : "Discount"} amount for ${draft.label}`}
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder="0"
                            className="w-20"
                            value={adjustmentDraft?.value ?? ""}
                            onChange={(event) =>
                              setAdjustmentDrafts((prev) => ({
                                ...prev,
                                [draft.key]: {
                                  kind: prev[draft.key]?.kind ?? "discount",
                                  mode: prev[draft.key]?.mode ?? "peso",
                                  value: event.target.value
                                }
                              }))
                            }
                          />
                          {adjustmentDraft?.value ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setAdjustmentDrafts((prev) => {
                                  const copy = { ...prev };
                                  delete copy[draft.key];
                                  return copy;
                                })
                              }
                            >
                              Clear
                            </Button>
                          ) : null}
                        </div>
                        {hasDiscount || hasSurcharge ? (
                          <p className="text-xs text-muted-foreground">
                            New line total:{" "}
                            <span className="font-medium text-foreground">
                              {formatPeso(netFee)}
                            </span>{" "}
                            ({hasDiscount ? "−" : "+"}
                            {formatPeso(hasDiscount ? discount : surcharge)})
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Remove one ${draft.label}`}
                      onClick={() =>
                        setServiceDraftQuantity(draft.key, quantity - 1)
                      }
                    >
                      <MinusIcon />
                    </Button>
                    <Input
                      aria-label={`Quantity of ${draft.label}`}
                      inputMode="numeric"
                      className="w-12 text-center"
                      value={quantity}
                      onChange={(event) =>
                        setServiceDraftQuantity(
                          draft.key,
                          Number.parseInt(event.target.value, 10) || 0
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Add one ${draft.label}`}
                      onClick={() =>
                        setServiceDraftQuantity(draft.key, quantity + 1)
                      }
                    >
                      <PlusIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${draft.label} from sale`}
                      onClick={() => removeServiceDraft(draft.key)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <label className="flex items-start gap-1 rounded-lg border p-1 text-xs has-[[data-checked]]:border-ring has-[[data-checked]]:bg-muted/30">
        <Checkbox
          name="personal_take"
          value="on"
          checked={personalTake}
          onCheckedChange={setPersonalTake}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Personal take (Utang)</span>
        </span>
      </label>

      {/* One payment method and one "Customer gave" for the whole sale —
          cart and every service line together, same as an item-only sale
          always worked. Shown whenever there's a cart to pay for (and it's
          not a personal take, which has no payment) or at least one
          service (services always need a payment method regardless of
          personalTake, since that flag only concerns the cart). */}
      {showPaymentSection ? (
        // 65/35 fr split — payment method gets 65%, Customer gave gets
        // 35% — rather than content-sized, so the split holds steady
        // regardless of how wide "GCash"/"Maya" render.
        <div className="grid grid-cols-[65fr_35fr] items-end gap-3">
          <div
            className={
              paymentMethod === "cash"
                ? "flex flex-col gap-2"
                : "col-span-2 flex flex-col gap-2"
            }
          >
            <Label className="text-xs">Payment method</Label>
            <Tabs
              value={paymentMethod}
              onValueChange={(value) =>
                setPaymentMethod(value as PaymentMethod)
              }
              className="w-full min-w-0"
            >
              <TabsList className="w-full sm:w-fit">
                {PAYMENT_METHODS.map((method) => (
                  <TabsTrigger key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Cash only. Unmounting on wallet payments also removes the input
              from the form, so nothing stray is submitted. */}
          {paymentMethod === "cash" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tendered" className="text-xs">
                Customer gave
              </Label>
              <Input
                id="tendered"
                name="tendered"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="Blank if exact"
                value={tendered}
                onChange={(event) => setTendered(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state.visitId ? (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span>{personalTake ? "Take recorded." : "Sale recorded."}</span>
          {doneSlot ?? (
            <Link href="/" className="underline">
              Back to sales
            </Link>
          )}
        </div>
      ) : null}

      <DrawerFooter className="flex-row items-center justify-between gap-3 border-t p-0 pt-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {personalTake ? "Value taken" : "Total"}
            {pieceCount > 0
              ? ` · ${pieceCount} pc${pieceCount === 1 ? "" : "s"}`
              : ""}
            {totalDiscount > 0 ? ` · −${formatPeso(totalDiscount)} off` : ""}
            {totalSurcharge > 0
              ? ` · +${formatPeso(totalSurcharge)} added`
              : ""}
            {serviceDrafts.length > 0
              ? ` · ${serviceDrafts.length} service${serviceDrafts.length === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPeso(grandTotal)}
          </p>
          {serviceFeesTotal > 0 ? (
            <p className="text-xs text-muted-foreground">
              Includes {formatPeso(serviceFeesTotal)} service income
            </p>
          ) : null}
        </div>
        {showPaymentSection &&
        paymentMethod === "cash" &&
        tenderedAmount !== null ? (
          <div data-testid="change-line" className="text-right">
            {tenderedAmount < grandTotal ? (
              <p className="text-sm font-medium text-destructive">
                Short {formatPeso(grandTotal - tenderedAmount)}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Change</p>
                <p className="text-xl font-semibold tabular-nums">
                  {formatPeso(tenderedAmount - grandTotal)}
                </p>
              </>
            )}
          </div>
        ) : null}
        <Button
          type="submit"
          disabled={
            isPending ||
            (cart.length === 0 && serviceDrafts.length === 0) ||
            insufficient
          }
        >
          {isPending
            ? "Recording…"
            : personalTake
              ? "Record personal take"
              : "Record sale"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
