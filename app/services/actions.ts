"use server";

import { revalidatePath } from "next/cache";

import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isMoneyAccount } from "@/lib/types";

export type ServiceSaleState = { error: string | null; recordedId?: string };

/**
 * Records a service (GCash load, cash-out, …). The client sends only the
 * service id and the two amounts — the cash direction comes from the service
 * row server-side, same principle as product prices in checkout.
 */
export async function recordServiceSale(
  _prev: ServiceSaleState,
  formData: FormData
): Promise<ServiceSaleState> {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  if (!serviceId) return { error: "Pick a service first." };

  const rawPrincipal = parseMoney(formData.get("principal"));
  if (rawPrincipal === "bad" || rawPrincipal === null) {
    return { error: "Amount must be a number with at most 2 decimal places." };
  }

  const fee = parseMoney(formData.get("fee"));
  if (fee === "bad" || fee === null) {
    return { error: "Fee must be a number with at most 2 decimal places." };
  }

  if (rawPrincipal + fee <= 0) {
    return { error: "Enter an amount or a fee." };
  }

  const paymentAccount = String(formData.get("payment_account") ?? "");
  if (!isMoneyAccount(paymentAccount)) {
    return { error: "Pick where the money moves through." };
  }

  const tendered = parseMoney(formData.get("tendered"), { allowBlank: true });
  if (tendered === "bad") {
    return { error: "Amount received must be a valid amount." };
  }

  const contactNumber = String(formData.get("contact_number") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const supabase = await createClient();

  const { data: serviceRow, error: serviceError } = await supabase
    .from("services")
    .select("cash_flow")
    .eq("id", serviceId)
    .single();
  if (serviceError || !serviceRow) {
    return { error: "Service not found." };
  }

  // Cash-in only: some customers ask for the fee to come out of the load
  // instead of paying extra cash for it — an opt-in choice, so `principal`
  // shrinks by the fee before it ever reaches record_service(). Ignored
  // entirely outside of cash-in — even if a crafted request sends it for a
  // cash-out, it has no effect here.
  const deductFeeRequested = formData.get("deduct_fee") === "on";
  const principal =
    serviceRow.cash_flow === "in" && deductFeeRequested
      ? rawPrincipal - fee
      : rawPrincipal;
  if (principal < 0) {
    return { error: "Fee can't be more than the amount." };
  }

  // Cash-out only: whether the fee lands as its own cash entry (default) or
  // gets embedded in the wallet-side transfer instead — record_service()
  // itself decides based on this flag, since the two modes post a different
  // number of ledger entries.
  const feeInWallet = formData.get("fee_in_wallet") === "on";

  const { data, error } = await supabase.rpc("record_service", {
    p_service_id: serviceId,
    p_principal: principal,
    p_fee: fee,
    p_payment_account: paymentAccount,
    p_fee_in_wallet: feeInWallet,
    ...(contactNumber ? { p_contact_number: contactNumber } : {}),
    ...(reference ? { p_reference: reference } : {}),
    ...(description ? { p_description: description } : {}),
    ...(tendered !== null ? { p_tendered: tendered } : {}),
  });

  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/vault");
  return { error: null, recordedId: data as string };
}
