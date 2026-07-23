"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isMoneyAccount, type FeeTier, type MoneyAccount } from "@/lib/types";

export type ServiceFormState = { error: string | null };

type Parsed = {
  name: string;
  cash_flow: "in" | "out";
  default_fee: number | null;
  wallet: "gcash" | "maya" | null;
  allowed_payment_accounts: MoneyAccount[];
  fee_tiers: FeeTier[];
};

/** Never trusts the client-sent tiers JSON blindly — every field is
    re-parsed with the same money-parsing rules as everything else in this
    file. Sorted by min ascending on the way out: resolution (in
    lib/types.ts's feeForPrincipal) picks the first matching tier in array
    order, so storage order has to be deterministic regardless of how the
    tiers were entered/reordered in the form. */
function parseFeeTiersInput(raw: string): FeeTier[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return { error: "Could not read the fee tiers." };
  }
  if (!Array.isArray(parsed)) return { error: "Could not read the fee tiers." };

  const tiers: FeeTier[] = [];
  for (const [i, entry] of parsed.entries()) {
    const label = `Tier ${i + 1}`;
    const line = (entry ?? {}) as Record<string, unknown>;

    const min = parseMoney(String(line.min ?? ""));
    if (min === "bad" || min === null) {
      return { error: `${label}: enter a minimum amount.` };
    }

    const fee = parseMoney(String(line.fee ?? ""));
    if (fee === "bad" || fee === null) {
      return { error: `${label}: enter a fee.` };
    }

    const max = parseMoney(String(line.max ?? ""), { allowBlank: true });
    if (max === "bad") {
      return { error: `${label}: max must be a valid amount.` };
    }
    if (max !== null && max < min) {
      return { error: `${label}: max must be at least the minimum.` };
    }

    tiers.push({ min, max, fee });
  }

  tiers.sort((a, b) => a.min - b.min);
  return tiers;
}

function parseForm(formData: FormData): Parsed | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const flow = String(formData.get("cash_flow") ?? "");
  if (flow !== "in" && flow !== "out") {
    return { error: "Choose whether cash goes in or out of the box." };
  }

  const default_fee = parseMoney(formData.get("default_fee"), {
    allowBlank: true,
  });
  if (default_fee === "bad") {
    return { error: "Default fee must be a number with at most 2 decimals." };
  }

  const walletRaw = String(formData.get("wallet") ?? "");
  const wallet =
    walletRaw === "gcash" || walletRaw === "maya" ? walletRaw : null;

  const allowed_payment_accounts = formData
    .getAll("allowed_payment_accounts")
    .map(String)
    .filter(isMoneyAccount);
  if (allowed_payment_accounts.length === 0) {
    return { error: "Choose at least one accepted payment method." };
  }

  const fee_tiers = parseFeeTiersInput(String(formData.get("fee_tiers") ?? "[]"));
  if ("error" in fee_tiers) return fee_tiers;

  return {
    name,
    cash_flow: flow,
    default_fee,
    wallet,
    allowed_payment_accounts,
    fee_tiers,
  };
}

export async function createService(
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  const parsed = parseForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("services").insert(parsed);
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  revalidatePath("/");
  redirect("/inventory?tab=services");
}

export async function updateService(
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing service id." };

  const parsed = parseForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("services").update(parsed).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  revalidatePath("/");
  redirect("/inventory?tab=services");
}

export async function deleteService(
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing service id." };

  const supabase = await createClient();
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) return { error: error.message };

  // History is safe: service_transactions snapshots name/direction, and its
  // service_id is ON DELETE SET NULL.
  revalidatePath("/inventory");
  revalidatePath("/");
  return { error: null };
}
