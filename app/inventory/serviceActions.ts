"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export type ServiceFormState = { error: string | null };

type Parsed = {
  name: string;
  cash_flow: "in" | "out";
  default_fee: number | null;
  wallet: "gcash" | "maya" | null;
};

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

  return { name, cash_flow: flow, default_fee, wallet };
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
