"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { parseMoney, parseWholeNumber } from "@/lib/money";
import { pool } from "@/lib/mysql/pool";
import {
  recordBulkRestock,
  type BulkRestockLine,
  type RestockPaymentSplit,
  type RestockPaymentSource,
} from "@/lib/mysql/operations/recordBulkRestock";
import { isMoneyAccount, isProfitFund } from "@/lib/types";

function isRestockPaymentSource(value: string): value is RestockPaymentSource {
  return isMoneyAccount(value) || isProfitFund(value);
}

export type InventoryState = { error: string | null };

type Parsed = {
  name: string;
  price: number;
  /** Current per-item cost — drives the profit shown on sales. Blank means
      "unknown," not zero. Normally kept up to date by restocking; editable
      here to correct it directly. */
  cost: number | null;
  stock: number | null;
  description: string | null;
  category_id: string | null;
  /** Blank means "use the store-wide default" (NULL) — a whole-number
      override of when this specific item's row starts reading as "low." */
  low_stock_threshold: number | null;
  /** "YYYY-MM-DD", or null for items that don't expire. */
  expiry_date: string | null;
};

function parseForm(formData: FormData): Parsed | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const price = parseMoney(formData.get("price"));
  if (price === "bad" || price === null) {
    return { error: "Price must be a number with at most 2 decimal places." };
  }

  const cost = parseMoney(formData.get("cost"), { allowBlank: true });
  if (cost === "bad") {
    return { error: "Cost must be a number with at most 2 decimal places." };
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

  // "YYYY-MM-DD" from the native date input, or blank for items that don't
  // expire. Stored as a plain date (no time/timezone) — the inventory list
  // compares it against the store's own calendar day, same reasoning
  // day-grouping elsewhere in the app already uses.
  const expiryDateRaw = String(formData.get("expiry_date") ?? "").trim();
  let expiryDate: string | null = null;
  if (expiryDateRaw) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(expiryDateRaw) ||
      Number.isNaN(new Date(expiryDateRaw).getTime())
    ) {
      return { error: "Expiry date must be a valid date." };
    }
    expiryDate = expiryDateRaw;
  }

  return {
    name,
    price,
    cost,
    stock: counted,
    description: description || null,
    category_id: categoryId || null,
    low_stock_threshold: lowStockThreshold,
    expiry_date: expiryDate,
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

  await pool.query(
    `UPDATE products
     SET name = ?, price = ?, cost = ?, description = ?, category_id = ?, stock = ?, low_stock_threshold = ?, expiry_date = ?
     WHERE id = ?`,
    [
      parsed.name,
      parsed.price,
      parsed.cost,
      parsed.description,
      parsed.category_id,
      parsed.stock,
      parsed.low_stock_threshold,
      parsed.expiry_date,
      id,
    ]
  );

  revalidatePath("/inventory");
  revalidatePath("/checkout");
  redirect("/inventory");
}

/** Logs a whole supplier receipt at once via recordBulkRestock — every line
    either restocks + re-prices an existing product, or creates a new one
    and restocks it in the same step, atomically. A line can no longer
    register a product without a quantity/cost — every product's cost is
    known from the moment it exists, so downstream profit figures never have
    to treat a newly-created item as "cost unknown." Never trusts the
    client-sent cart JSON blindly: every field is re-parsed with the same
    helpers every other form in this file uses. */
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

  const items: BulkRestockLine[] = [];
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

    // Every line restocks — existing or brand-new, quantity + cost are
    // always required now (see this function's own doc comment for why a
    // product can no longer be registered with an unknown cost).
    const quantityRaw = String(line.quantity ?? "").trim();
    const costRaw = String(line.cost ?? "").trim();

    const q = parseWholeNumber(quantityRaw);
    if (q === "bad" || q === null || q <= 0) {
      return { error: `${label}: quantity must be a whole number greater than 0.` };
    }
    const c = parseMoney(costRaw);
    if (c === "bad" || c === null) {
      return { error: `${label}: cost must be a valid amount.` };
    }
    const quantity = q;
    const cost = c;

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
      productId,
      name: productId ? null : name,
      quantity,
      cost,
      price,
      categoryId: productId ? null : categoryId,
      description: productId ? null : description,
    });
  }

  // Optional whole-batch "paid with" split — see recordBulkRestock's own
  // doc comment on why this doesn't have to add up to the batch total.
  let rawPayment: unknown;
  try {
    rawPayment = JSON.parse(String(formData.get("payment") ?? "[]"));
  } catch {
    return { error: "Could not read the payment split." };
  }
  if (!Array.isArray(rawPayment)) {
    return { error: "Could not read the payment split." };
  }
  const payment: RestockPaymentSplit[] = [];
  for (const entry of rawPayment) {
    const line = (entry ?? {}) as Record<string, unknown>;
    const source = typeof line.source === "string" ? line.source : "";
    if (!isRestockPaymentSource(source)) {
      return { error: "Payment split has an invalid source." };
    }
    const amount = parseMoney(String(line.amount ?? ""), { requirePositive: true });
    if (amount === "bad" || amount === null) {
      return { error: "Each payment amount must be more than 0." };
    }
    payment.push({ source, amount });
  }

  try {
    const user = await requireCurrentUser();
    await recordBulkRestock(
      { items, payment: payment.length > 0 ? payment : undefined },
      user.id
    );
  } catch (err) {
    return { error: (err as Error).message };
  }

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

  // Past sales are unaffected: transaction_items snapshots the name and
  // price, and its product_id is ON DELETE SET NULL.
  await pool.query("DELETE FROM products WHERE id = ?", [id]);

  revalidatePath("/inventory");
  revalidatePath("/checkout");
  return { error: null };
}
