"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseMoney, parseWholeNumber } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export type InventoryState = { error: string | null };

type Parsed = {
  name: string;
  price: number;
  stock: number | null;
  description: string | null;
  category_id: string | null;
};

function parseForm(formData: FormData): Parsed | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const price = parseMoney(formData.get("price"));
  if (price === "bad" || price === null) {
    return { error: "Price must be a number with at most 2 decimal places." };
  }

  // Blank quantity means "not tracked" (NULL) — deliberately distinct from 0
  // ("tracked, none left"). Negative is allowed: overselling drives stock
  // below zero, and the row must stay editable so the owner can recount.
  const counted = parseWholeNumber(formData.get("stock"), {
    allowNegative: true,
  });
  if (counted === "bad") {
    return { error: "Quantity must be a whole number, or left blank." };
  }

  // Restock: quantity just bought, ADDED to the counted stock rather than
  // replacing it. A restock on an untracked item starts counting it.
  const restock = parseWholeNumber(formData.get("restock_qty"));
  if (restock === "bad") {
    return { error: "Qty bought must be a whole number." };
  }
  const stock =
    restock !== null && restock > 0 ? (counted ?? 0) + restock : counted;

  const description = String(formData.get("description") ?? "").trim();

  // Empty means "no category". A non-empty value must reference a real row —
  // the foreign key rejects anything else, so no UUID validation needed here.
  const categoryId = String(formData.get("category_id") ?? "").trim();

  return {
    name,
    price,
    stock,
    description: description || null,
    category_id: categoryId || null,
  };
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
