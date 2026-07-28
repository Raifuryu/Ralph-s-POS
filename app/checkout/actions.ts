"use server";

import { revalidatePath } from "next/cache";

import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isMoneyAccount } from "@/lib/types";

export type VisitState = { error: string | null; visitId?: string };

type ServiceLinePayload = {
  service_id?: string;
  principal?: number;
  fee?: number;
  /** Per-unit lines only — the sheet already nets this out of `fee`, sent
      separately just so it's recorded (see migration 0032). Always 0 for a
      flat/tiered line. */
  discount_amount?: number;
  payment_account?: string;
  deduct_fee?: boolean;
  fee_in_wallet?: boolean;
  unit_label?: string | null;
  unit_quantity?: number | null;
  unit_price?: number | null;
  contact_number?: string;
  reference?: string;
  description?: string;
};

/**
 * Records a whole visit atomically: a product cart, any number of
 * e-service lines, or both together (see migration 0031's record_visit(),
 * which composes checkout() and record_service() in one transaction — if
 * any line fails, nothing commits).
 *
 * Note what is and isn't trusted: product prices always come from the
 * products table server-side, never the client (see checkout()). A service
 * line's amount/fee, on the other hand, is exactly what the cashier typed
 * while configuring it — the same trust level the old standalone e-service
 * flow already had, just validated here instead of in a per-line action.
 */
export async function recordVisit(
  _prevState: VisitState,
  formData: FormData
): Promise<VisitState> {
  const personalTake = formData.get("personal_take") === "on";

  const paymentMethod = personalTake
    ? null
    : String(formData.get("payment_method") ?? "");

  let cart: {
    product_id: string;
    quantity: number;
    discount_amount?: number;
  }[];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    return { error: "Could not read the cart." };
  }
  const items = cart.filter((line) => line.quantity > 0);

  let rawServices: ServiceLinePayload[];
  try {
    rawServices = JSON.parse(String(formData.get("services") ?? "[]"));
  } catch {
    return { error: "Could not read the added services." };
  }

  if (items.length === 0 && rawServices.length === 0) {
    return {
      error: personalTake
        ? "Add at least one item before recording the take."
        : "Add at least one item or service before recording the sale."
    };
  }

  // A product cart still needs a payment method (unless it's a personal
  // take). Services always send one too — the sale's single shared choice,
  // forwarded verbatim from the client rather than picked per line — the
  // isMoneyAccount check on each line below is defense-in-depth, not a
  // real per-line decision.
  if (
    items.length > 0 &&
    !personalTake &&
    !isMoneyAccount(paymentMethod ?? "")
  ) {
    return { error: "Choose a payment method." };
  }
  // The client already clamps a line's discount to its own subtotal, and
  // checkout() clamps again server-side regardless — this just rejects a
  // malformed/negative value early with a clearer message than the RPC's.
  if (
    items.some(
      (line) =>
        line.discount_amount !== undefined &&
        (!Number.isFinite(line.discount_amount) || line.discount_amount < 0)
    )
  ) {
    return { error: "Discount must be a non-negative amount." };
  }

  // Optional: what the customer handed over. transactions.tendered only
  // has a well-defined meaning against the cart's own total (checkout()
  // validates tendered >= cart total, and the transaction list later shows
  // "change" as tendered - total) — once services are in the mix, the
  // amount typed covers the whole combined sale instead, which doesn't
  // split back cleanly onto just the cart. Rather than store a number that
  // would make the transaction list's change math wrong, it's simply not
  // recorded for a mixed or services-only sale; the live change preview in
  // the sheet still helps the cashier in the moment, it just isn't kept.
  const tendered =
    personalTake || items.length === 0 || rawServices.length > 0
      ? null
      : parseMoney(formData.get("tendered"), { allowBlank: true });
  if (tendered === "bad") {
    return { error: "Amount received must be a valid amount." };
  }

  for (const line of rawServices) {
    if (!line.service_id) {
      return { error: "A service line is missing which service it's for." };
    }
    if (
      !Number.isFinite(line.principal) ||
      (line.principal as number) < 0 ||
      !Number.isFinite(line.fee) ||
      (line.fee as number) < 0
    ) {
      return { error: "Each service needs a valid amount and fee." };
    }
    if (!isMoneyAccount(line.payment_account ?? "")) {
      return { error: "Each service needs a payment method." };
    }
    // The client already clamps a per-unit line's discount to its own
    // subtotal, and record_service() clamps again server-side regardless —
    // this just rejects a malformed/negative value early with a clearer
    // message, same as the cart's own discount check above.
    if (
      line.discount_amount !== undefined &&
      (!Number.isFinite(line.discount_amount) || line.discount_amount < 0)
    ) {
      return { error: "Discount must be a non-negative amount." };
    }
    const hasAnyUnit =
      line.unit_label != null ||
      line.unit_quantity != null ||
      line.unit_price != null;
    const hasAllUnit =
      line.unit_label != null &&
      line.unit_quantity != null &&
      line.unit_price != null;
    if (hasAnyUnit && !hasAllUnit) {
      return { error: "A per-item service is missing its variant details." };
    }
  }

  const supabase = await createClient();

  // Cash-in only: some customers ask for the fee to come out of the load
  // instead of paying extra cash for it — looked up per service (not
  // trusted from the client alone), same defense-in-depth the old
  // standalone flow applied.
  let cashFlowByService = new Map<string, "in" | "out">();
  if (rawServices.length > 0) {
    const { data: serviceRows, error: serviceError } = await supabase
      .from("services")
      .select("id, cash_flow")
      .in("id", [
        ...new Set(rawServices.map((line) => line.service_id as string))
      ]);
    if (serviceError) {
      return { error: serviceError.message };
    }
    cashFlowByService = new Map(
      (serviceRows ?? []).map((row) => [row.id, row.cash_flow])
    );
  }

  // Non-null assertions below are safe: the validation loop above returns
  // early unless service_id/principal/fee/payment_account are all present
  // and valid on every line.
  const services = rawServices.map((line) => {
    const cashFlow = cashFlowByService.get(line.service_id as string);
    const rawPrincipal = line.principal as number;
    const fee = line.fee as number;
    const principal =
      cashFlow === "in" && line.deduct_fee ? rawPrincipal - fee : rawPrincipal;
    return {
      service_id: line.service_id,
      principal: Math.max(0, principal),
      fee,
      discount_amount: line.discount_amount ?? 0,
      payment_account: line.payment_account,
      fee_in_wallet: line.fee_in_wallet ?? false,
      unit_label: line.unit_label ?? null,
      unit_quantity: line.unit_quantity ?? null,
      unit_price: line.unit_price ?? null,
      contact_number: line.contact_number || undefined,
      reference: line.reference || undefined,
      description: line.description || undefined
    };
  });

  const { data, error } = await supabase.rpc("record_visit", {
    ...(items.length > 0 ? { p_items: items } : {}),
    p_personal_take: personalTake,
    // Validated above (isMoneyAccount) whenever items.length > 0 and this
    // isn't a personal take — the only cases this actually gets sent.
    ...(items.length > 0 && paymentMethod
      ? { p_payment_method: paymentMethod as "cash" | "gcash" | "maya" }
      : {}),
    ...(tendered !== null ? { p_tendered: tendered } : {}),
    ...(services.length > 0 ? { p_services: services } : {})
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/vault");
  return { error: null, visitId: data as string };
}
