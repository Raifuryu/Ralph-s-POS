import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { placeholders, queryConn } from "./helpers";
import { recordRestock } from "./recordRestock";

export type BulkRestockLine = {
  productId: string | null;
  name: string | null;
  quantity: number | null;
  cost: number | null;
  price: number;
  categoryId: string | null;
  description: string | null;
};

/** Port of record_bulk_restock(). Every line either restocks + re-prices an
    existing product (product_id set) or creates one, optionally stocking it
    too (product_id null). Line-shape validation is re-implemented here as
    plain TS checks in the same order the original SQL ran them (each with
    its own EXISTS check), so the first violation found produces the same
    error message a caller would have seen before. */
export async function recordBulkRestock(
  params: { items: BulkRestockLine[] },
  cashierId: string
): Promise<{ items: { productId: string; restockId: string | null }[] }> {
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

  // Existing-item lines are always a restock: quantity + cost are required.
  for (const line of items) {
    if (
      line.productId !== null &&
      (line.quantity === null || line.quantity <= 0 || line.cost === null || line.cost < 0)
    ) {
      throw new Error("Each restocked item needs a quantity of at least 1 and a cost of 0 or more");
    }
  }

  // New-item lines may register without stocking (quantity and cost both
  // null) or restock alongside creation (both present and valid) — never a
  // mix of only one.
  for (const line of items) {
    if (line.productId === null) {
      const quantityGiven = line.quantity !== null;
      const costGiven = line.cost !== null;
      if (
        quantityGiven !== costGiven ||
        (quantityGiven && (line.quantity! <= 0 || line.cost! < 0))
      ) {
        throw new Error("A new item needs both a quantity and a cost, or neither");
      }
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
    // new → create (stock starts NULL/untracked either way) then restock
    // only if quantity/cost were given.
    const result: { productId: string; restockId: string | null }[] = [];
    for (const line of items) {
      const name = line.name?.trim() || null;
      const description = line.description?.trim() || null;
      let productId: string;

      if (line.productId !== null) {
        productId = line.productId;
        await conn.query("UPDATE products SET price = ? WHERE id = ?", [line.price, productId]);
      } else {
        productId = randomUUID();
        await conn.query(
          "INSERT INTO products (id, name, price, stock, category_id, description) VALUES (?, ?, ?, NULL, ?, ?)",
          [productId, name, line.price, line.categoryId, description]
        );
      }

      let restockId: string | null = null;
      if (line.quantity !== null) {
        restockId = await recordRestock(conn, {
          productId,
          quantity: line.quantity,
          cost: line.cost!,
          cashierId,
        });
      }

      result.push({ productId, restockId });
    }

    return { items: result };
  });
}
