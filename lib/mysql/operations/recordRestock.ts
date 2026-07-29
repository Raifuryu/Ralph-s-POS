import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";

import { queryConn, roundMoney } from "./helpers";

/**
 * Port of record_restock(). Called only by recordBulkRestock, which is
 * responsible for locking the referenced product row before calling this —
 * matching the original SQL function, which never took its own lock either
 * (the direct-callable Postgres function relied on the same caller
 * discipline; the app never called it directly).
 */
export async function recordRestock(
  conn: PoolConnection,
  params: {
    productId: string;
    quantity: number;
    cost: number;
    note?: string | null;
    cashierId: string;
  }
): Promise<string> {
  const { productId, quantity, cost, cashierId } = params;
  const note = params.note?.trim() || null;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be more than 0");
  }
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Cost must be 0 or more");
  }

  const products = await queryConn<{ name: string }>(
    conn,
    "SELECT name FROM products WHERE id = ?",
    [productId]
  );
  const product = products[0];
  if (!product) throw new Error("Product not found");

  const id = randomUUID();
  await conn.query(
    "INSERT INTO product_restocks (id, product_id, product_name, quantity, cost, note, cashier_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, productId, product.name, quantity, cost, note, cashierId]
  );

  await conn.query(
    "UPDATE products SET stock = COALESCE(stock, 0) + ?, cost = ? WHERE id = ?",
    [quantity, roundMoney(cost / quantity), productId]
  );

  return id;
}
