"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type InventoryState = { error: string | null };

/**
 * Quantity is optional. An empty field means "not quantity-tracked" (NULL),
 * which is NOT the same as 0 ("tracked, none left"): checkout neither
 * decrements nor blocks a NULL, but refuses to oversell a 0.
 */
function parseQuantity(raw: FormDataEntryValue | null): number | null | "bad" {
  const value = String(raw ?? "").trim();
  if (value === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return "bad";
  return parsed;
}

function parsePrice(raw: FormDataEntryValue | null): number | "bad" {
  const value = String(raw ?? "").trim();
  if (value === "") return "bad";

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "bad";
  // numeric(10,2) — reject more precision than the column can hold rather than
  // letting Postgres round it silently.
  if (Math.round(parsed * 100) !== parsed * 100) return "bad";
  return parsed;
}

type Parsed = {
  name: string;
  price: number;
  stock: number | null;
  description: string | null;
};

function parseForm(formData: FormData): Parsed | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const price = parsePrice(formData.get("price"));
  if (price === "bad") {
    return { error: "Price must be a number with at most 2 decimal places." };
  }

  const stock = parseQuantity(formData.get("stock"));
  if (stock === "bad") {
    return { error: "Quantity must be a whole number, or left blank." };
  }

  const description = String(formData.get("description") ?? "").trim();

  return { name, price, stock, description: description || null };
}

export async function createProduct(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const parsed = parseForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(parsed);

  if (error) return { error: error.message };

  revalidatePath("/inventory");
  revalidatePath("/checkout");
  // Closes the form by dropping ?new — no client state to keep in sync.
  redirect("/inventory");
}

export async function updateProduct(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing product id." };

  const parsed = parseForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("products").update(parsed).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/inventory");
  revalidatePath("/checkout");
  redirect("/inventory");
}

export async function deleteProduct(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing product id." };

  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) return { error: error.message };

  // Past sales are unaffected: transaction_items snapshots the name and price,
  // and its product_id is ON DELETE SET NULL.
  revalidatePath("/inventory");
  revalidatePath("/checkout");
  return { error: null };
}
