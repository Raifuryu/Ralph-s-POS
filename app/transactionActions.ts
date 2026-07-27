"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type VoidState = { error: string | null };

/** Voids a mistaken sale or personal take: stock is returned and (for a
    real sale) a reversing entry nets the vault back down — see
    void_transaction() and migration 0023 for the actual reversal logic.
    Never deletes or edits the original transaction; voided_at just flags
    it, so it stays visible in the list as a struck-through, red record. */
export async function voidTransaction(
  _prev: VoidState,
  formData: FormData
): Promise<VoidState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing transaction id." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_transaction", {
    p_transaction_id: id,
  });
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/checkout");
  revalidatePath("/statistics");
  revalidatePath("/inventory");
  return { error: null };
}

/** Voids a mistaken e-service transaction: every vault_entries row it
    originally posted (2 or 3, depending on flow) gets a reversing entry —
    see void_service_transaction() and migration 0025. No stock is touched;
    services never affect inventory. Same "flag, never edit" approach as
    voidTransaction above. */
export async function voidServiceTransaction(
  _prev: VoidState,
  formData: FormData
): Promise<VoidState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing service transaction id." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_service_transaction", {
    p_service_transaction_id: id,
  });
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/statistics");
  return { error: null };
}
