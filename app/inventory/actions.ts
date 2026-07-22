"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseMoney, parseWholeNumber } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type InventoryState = { error: string | null };

type Parsed = {
  name: string;
  price: number;
  stock: number | null;
  description: string | null;
  category_id: string | null;
  /** Present (> 0) means this submit also restocks — logged via the
      record_restock RPC (batch qty + cost), run after the plain products
      update above so it adds to whatever `stock` that update just wrote. */
  restockQty: number | null;
  restockCost: number | null;
};

/** Runs after the products update, so a restock always adds to the just-
    written stock value rather than a stale pre-edit one. */
async function applyRestock(
  supabase: SupabaseClient<Database>,
  productId: string,
  parsed: Parsed
): Promise<{ error: string } | null> {
  if (parsed.restockQty === null) return null;

  const { error } = await supabase.rpc("record_restock", {
    p_product_id: productId,
    p_quantity: parsed.restockQty,
    p_cost: parsed.restockCost ?? 0,
  });
  return error ? { error: error.message } : null;
}

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
  const restockQtyRaw = parseWholeNumber(formData.get("restock_qty"));
  if (restockQtyRaw === "bad") {
    return { error: "Qty bought must be a whole number." };
  }
  const restockQty =
    restockQtyRaw !== null && restockQtyRaw > 0 ? restockQtyRaw : null;

  const restockCost = parseMoney(formData.get("restock_cost"), {
    allowBlank: restockQty === null,
  });
  if (restockCost === "bad") {
    return {
      error: "Price bought must be a number with at most 2 decimal places.",
    };
  }
  if (restockQty !== null && restockCost === null) {
    return { error: "Price bought is required when restocking." };
  }

  const description = String(formData.get("description") ?? "").trim();

  // Empty means "no category". A non-empty value must reference a real row —
  // the foreign key rejects anything else, so no UUID validation needed here.
  const categoryId = String(formData.get("category_id") ?? "").trim();

  return {
    name,
    price,
    stock: counted,
    description: description || null,
    category_id: categoryId || null,
    restockQty,
    restockCost,
  };
}

export async function createProduct(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const parsed = parseForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("products")
    .insert({
      name: parsed.name,
      price: parsed.price,
      stock: parsed.stock,
      description: parsed.description,
      category_id: parsed.category_id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const restockError = await applyRestock(supabase, created.id, parsed);
  if (restockError) return restockError;

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

  // Always write the manually-entered stock first — a restock in the same
  // submit runs its RPC afterward (below) and adds to whatever this write
  // just wrote, so a correction and a restock in one submit both land.
  const { error } = await supabase
    .from("products")
    .update({
      name: parsed.name,
      price: parsed.price,
      description: parsed.description,
      category_id: parsed.category_id,
      stock: parsed.stock,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  const restockError = await applyRestock(supabase, id, parsed);
  if (restockError) return restockError;

  revalidatePath("/inventory");
  revalidatePath("/checkout");
  redirect("/inventory");
}

type BulkRestockItem = {
  product_id: string | null;
  name: string | null;
  quantity: number;
  cost: number;
  price: number;
};

/** Logs a whole supplier receipt at once via record_bulk_restock — every
    line either restocks + re-prices an existing product or creates a new
    one and restocks it, atomically. Never trusts the client-sent cart JSON
    blindly: every field is re-parsed with the same helpers every other form
    in this file uses. */
export async function bulkRestock(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    return { error: "Could not read the cart." };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Add at least one item before submitting." };
  }

  const items: BulkRestockItem[] = [];
  const seen = new Set<string>();

  for (const [i, entry] of raw.entries()) {
    const line = (entry ?? {}) as Record<string, unknown>;
    const label = `Line ${i + 1}`;

    const productId =
      typeof line.product_id === "string" && line.product_id
        ? line.product_id
        : null;
    const name = typeof line.name === "string" ? line.name.trim() : "";

    if (!productId && !name) {
      return { error: `${label}: pick an item or type a name for the new one.` };
    }
    if (productId) {
      if (seen.has(productId)) {
        return { error: `${label}: this item is already in the cart.` };
      }
      seen.add(productId);
    }

    const quantity = parseWholeNumber(String(line.quantity ?? ""));
    if (quantity === "bad" || quantity === null || quantity <= 0) {
      return { error: `${label}: quantity must be a whole number greater than 0.` };
    }

    const cost = parseMoney(String(line.cost ?? ""));
    if (cost === "bad" || cost === null) {
      return { error: `${label}: cost must be a valid amount.` };
    }

    const price = parseMoney(String(line.price ?? ""), { requirePositive: true });
    if (price === "bad" || price === null) {
      return { error: `${label}: price must be greater than 0.` };
    }

    items.push({
      product_id: productId,
      name: productId ? null : name,
      quantity,
      cost,
      price,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_bulk_restock", {
    p_items: items,
  });
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
