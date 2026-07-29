"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentUser } from "@/lib/auth/session";
import { voidTransaction as voidTransactionOperation } from "@/lib/mysql/operations/voidTransaction";
import { voidServiceTransaction as voidServiceTransactionOperation } from "@/lib/mysql/operations/voidServiceTransaction";

export type VoidState = { error: string | null };

/** Voids a mistaken sale or personal take: stock is returned and (for a
    real sale) a reversing entry nets the vault back down — see
    lib/mysql/operations/voidTransaction.ts for the actual reversal logic.
    Never deletes or edits the original transaction; voided_at just flags
    it, so it stays visible in the list as a struck-through, red record. */
export async function voidTransaction(
  _prev: VoidState,
  formData: FormData
): Promise<VoidState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing transaction id." };

  try {
    const user = await requireCurrentUser();
    await voidTransactionOperation({ transactionId: id }, user.id);
  } catch (err) {
    return { error: (err as Error).message };
  }

  revalidatePath("/");
  revalidatePath("/checkout");
  revalidatePath("/statistics");
  revalidatePath("/inventory");
  return { error: null };
}

/** Voids a mistaken e-service transaction: every vault_entries row it
    originally posted (2 or 3, depending on flow) gets a reversing entry —
    see lib/mysql/operations/voidServiceTransaction.ts. No stock is touched;
    services never affect inventory. Same "flag, never edit" approach as
    voidTransaction above. */
export async function voidServiceTransaction(
  _prev: VoidState,
  formData: FormData
): Promise<VoidState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing service transaction id." };

  try {
    const user = await requireCurrentUser();
    await voidServiceTransactionOperation({ serviceTransactionId: id }, user.id);
  } catch (err) {
    return { error: (err as Error).message };
  }

  revalidatePath("/");
  revalidatePath("/statistics");
  return { error: null };
}
