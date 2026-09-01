import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { placeholders, queryConn, roundMoney } from "./helpers";
import { recordRestock } from "./recordRestock";

export type BulkRestockLine = {
  productId: string | null;
  name: string | null;
  /** Always required now — a product can no longer be registered without
      being restocked in the same step, so every line always both creates
      (or re-prices) a product AND restocks it. */
  quantity: number;
  cost: number;
  price: number;
  categoryId: string | null;
  description: string | null;
};

/** Port of record_bulk_restock(). Every line either restocks + re-prices an
    existing product (product_id set) or creates one and restocks it in the
    same step (product_id null) — every line always restocks, there's no
    "register without stocking" shortcut anymore (see this file's own
    history: that shortcut was how a product could end up with an unknown
    cost, which then had to be special-cased in every profit figure
    downstream). Line-shape validation is re-implemented here as plain TS
    checks in the same order the original SQL ran them (each with its own
    EXISTS check), so the first violation found produces the same error
    message a caller would have seen before. */
export async function recordBulkRestock(
  params: { items: BulkRestockLine[] },
  cashierId: string
): Promise<{ items: { productId: string; restockId: string }[] }> {
  const { items } = params;
  if (!items || items.length === 0) {
    throw new Error("Cart is empty");
  }

  // Exactly one of product_id/name per line; price always required.
  for (const line of items) {
    const hasName = Boolean(line.name?.trim());
    const hasProductId = line.productId !== null;
    if ((!hasProductId && !hasName) || (hasProductId && hasName) || line.price === null || line.price <= 0) {
      throw new Error(
        "Each line needs an existing item or a new name (not both), and a price greater than 0"
      );
    }
  }

  // Every line restocks — quantity + cost are always required, whether it's
  // an existing product or a brand-new one.
  for (const line of items) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isFinite(line.cost) ||
      line.cost < 0
    ) {
      throw new Error("Each item needs a quantity of at least 1 and a cost of 0 or more");
    }
  }

  // Reject the same existing product twice in one batch — with a per-line
  // price this is ambiguous (which price wins?).
  const existingIds = items
    .map((l) => l.productId)
    .filter((id): id is string => id !== null);
  const seen = new Set<string>();
  for (const id of existingIds) {
    if (seen.has(id)) {
      throw new Error("Each item can only appear once in a single bulk restock");
    }
    seen.add(id);
  }

  return withTransaction(async (conn) => {
    // Lock every existing product referenced, in a stable order, before any
    // write — same deadlock-avoidance rationale as checkout(). A row count
    // short of what was requested means something was deleted since the
    // form loaded.
    if (existingIds.length > 0) {
      const sortedIds = [...existingIds].sort();
      const locked = await queryConn<{ id: string }>(
        conn,
        `SELECT id FROM products WHERE id IN (${placeholders(sortedIds.length)}) ORDER BY id FOR UPDATE`,
        sortedIds
      );
      if (locked.length !== sortedIds.length) {
        throw new Error("One or more selected items no longer exist");
      }
    }

    // Apply each line in submitted order: existing → re-price then restock;
    // new → create (stock starts NULL, COALESCE'd to 0 inside recordRestock)
    // then restock. Every line restocks now — there's no longer a
    // create-without-stocking branch.
    const result: { productId: string; restockId: string }[] = [];
    for (const line of items) {
      const name = line.name?.trim() || null;
      const description = line.description?.trim() || null;
      // Rounded here rather than trusted as-is — same reasoning as
      // recordRestock's own cost rounding: products.price is DECIMAL(12,2),
      // and this app's MariaDB rejects an INSERT/UPDATE outright rather than
      // silently truncating a value with floating-point noise past the
      // centavo (e.g. a price computed backward from a markup percentage).
      const price = roundMoney(line.price);
      let productId: string;

      if (line.productId !== null) {
        productId = line.productId;
        await conn.query("UPDATE products SET price = ? WHERE id = ?", [price, productId]);
      } else {
        productId = randomUUID();
        await conn.query(
          "INSERT INTO products (id, name, price, stock, category_id, description) VALUES (?, ?, ?, NULL, ?, ?)",
          [productId, name, price, line.categoryId, description]
        );
      }

      const restockId = await recordRestock(conn, {
        productId,
        quantity: line.quantity,
        cost: line.cost,
        cashierId,
      });

      result.push({ productId, restockId });
    }

    return { items: result };
  });
}
