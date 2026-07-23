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
  /** Blank means "use the store-wide default" (NULL) — a whole-number
      override of when this specific item's row starts reading as "low." */
  low_stock_threshold: number | null;
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

  // Blank means "use the store default" (NULL) — distinct from 0, which is a
  // deliberate "flag this the moment it's not full" setting.
  const lowStockThreshold = parseWholeNumber(formData.get("low_stock_threshold"));
  if (lowStockThreshold === "bad") {
    return { error: "Low stock threshold must be a whole number, or left blank." };
  }

  return {
    name,
    price,
    stock: counted,
    description: description || null,
    category_id: categoryId || null,
    low_stock_threshold: lowStockThreshold,
    restockQty,
    restockCost,
  };
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
      low_stock_threshold: parsed.low_stock_threshold,
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
  quantity: number | null;
  cost: number | null;
  price: number;
  category_id: string | null;
  description: string | null;
};

/** Logs a whole supplier receipt at once via record_bulk_restock — every
    line either restocks + re-prices an existing product, or creates a new
    one (optionally restocking it too — a new item can also be registered
    with no quantity/cost, same as leaving Quantity blank on the old
    single-item form), atomically. Never trusts the client-sent cart JSON
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

    const quantityRaw = String(line.quantity ?? "").trim();
    const costRaw = String(line.cost ?? "").trim();

    let quantity: number | null = null;
    let cost: number | null = null;

    if (productId) {
      // Existing item: always a restock, quantity + cost are required.
      const q = parseWholeNumber(quantityRaw);
      if (q === "bad" || q === null || q <= 0) {
        return { error: `${label}: quantity must be a whole number greater than 0.` };
      }
      const c = parseMoney(costRaw);
      if (c === "bad" || c === null) {
        return { error: `${label}: cost must be a valid amount.` };
      }
      quantity = q;
      cost = c;
    } else if (quantityRaw !== "" || costRaw !== "") {
      // New item, partially filled in: must be both or neither.
      if ((quantityRaw === "") !== (costRaw === "")) {
        return { error: `${label}: enter both quantity and cost, or leave both blank.` };
      }
      const q = parseWholeNumber(quantityRaw);
      if (q === "bad" || q === null || q <= 0) {
        return { error: `${label}: quantity must be a whole number greater than 0.` };
      }
      const c = parseMoney(costRaw);
      if (c === "bad" || c === null) {
        return { error: `${label}: cost must be a valid amount.` };
      }
      quantity = q;
      cost = c;
    }
    // else: new item, both left blank — quantity/cost stay null (register
    // without stocking, same as leaving Quantity blank on the old form).

    const price = parseMoney(String(line.price ?? ""), { requirePositive: true });
    if (price === "bad" || price === null) {
      return { error: `${label}: price must be greater than 0.` };
    }

    const categoryId =
      typeof line.category_id === "string" && line.category_id
        ? line.category_id
        : null;
    const description =
      typeof line.description === "string" && line.description.trim()
        ? line.description.trim()
        : null;

    items.push({
      product_id: productId,
      name: productId ? null : name,
      quantity,
      cost,
      price,
      category_id: productId ? null : categoryId,
      description: productId ? null : description,
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
