"use server";

import { revalidatePath } from "next/cache";

import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isMoneyAccount } from "@/lib/types";

export type CheckoutState = { error: string | null; transactionId?: string };

/**
 * Records a sale. Note what is NOT sent: prices. The client sends only product
 * ids and quantities; `public.checkout` reads the price from the products table
 * server-side and snapshots it. A client that could name its own price could
 * sell itself anything for ₱0.
 */
export async function recordSale(
  _prevState: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  const personalTake = formData.get("personal_take") === "on";

  let paymentMethod: string | null = null;
  if (!personalTake) {
    paymentMethod = String(formData.get("payment_method") ?? "");
    if (!isMoneyAccount(paymentMethod)) {
      return { error: "Choose a payment method." };
    }
  }

  let cart: { product_id: string; quantity: number }[];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    return { error: "Could not read the cart." };
  }

  const items = cart.filter((line) => line.quantity > 0);
  if (items.length === 0) {
    return {
      error: personalTake
        ? "Add at least one item before recording the take."
        : "Add at least one item before recording the sale.",
    };
  }

  // Optional: what the customer handed over (cash sales only). The DB
  // enforces tendered >= total and cash-only; this is just early validation.
  // A personal take never has anything tendered — nobody paid.
  const tendered = personalTake
    ? null
    : parseMoney(formData.get("tendered"), { allowBlank: true });
  if (tendered === "bad") {
    return { error: "Amount received must be a valid amount." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkout", {
    p_items: items,
    p_personal_take: personalTake,
    ...(paymentMethod !== null ? { p_payment_method: paymentMethod } : {}),
    ...(tendered !== null ? { p_tendered: tendered } : {}),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return { error: null, transactionId: data as string };
}
