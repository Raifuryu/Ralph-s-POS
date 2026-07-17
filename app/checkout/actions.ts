"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isPaymentMethod } from "@/lib/types";

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
  const paymentMethod = String(formData.get("payment_method") ?? "");
  if (!isPaymentMethod(paymentMethod)) {
    return { error: "Choose a payment method." };
  }

  let cart: { product_id: string; quantity: number }[];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    return { error: "Could not read the cart." };
  }

  const items = cart.filter((line) => line.quantity > 0);
  if (items.length === 0) {
    return { error: "Add at least one item before recording the sale." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkout", {
    p_payment_method: paymentMethod,
    p_items: items,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return { error: null, transactionId: data as string };
}
