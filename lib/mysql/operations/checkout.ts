import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";

import type { MoneyAccount } from "@/lib/types";
import { placeholders, queryConn, roundMoney } from "./helpers";

type CartLine = {
  productId: string;
  quantity: number;
  discountAmount?: number;
  /** Extra charged on top of price x quantity — the inverse of a discount,
      for a line sold above its usual price. Never trusted alone: it's just
      an additive amount, not a substitute for the locked product price
      above, so a compromised client still can't check out below the real
      price by lying about this. */
  surchargeAmount?: number;
};

/**
 * Port of checkout(). Never trusts client-submitted prices — the total and
 * every line's unit_price/unit_cost are re-derived here from the locked
 * products row, exactly like the original SQL joined against `products`
 * rather than accepting a price in `p_items`.
 */
export async function checkout(
  conn: PoolConnection,
  params: {
    items: CartLine[];
    paymentMethod: MoneyAccount | null;
    tendered: number | null;
    personalTake: boolean;
    /** Personal-take only — who it's for and why, capturable right at
        checkout instead of only later from Vault → Personal takes (see
        settlePersonalTake/labelPersonalTake). */
    debtorName: string | null;
    debtorDescription: string | null;
    visitId: string | null;
  },
  cashierId: string
): Promise<string> {
  const { items, paymentMethod, tendered, personalTake, debtorName, debtorDescription, visitId } =
    params;

  if (!items || items.length === 0) {
    throw new Error("Cart is empty");
  }

  if (personalTake) {
    if (paymentMethod !== null || tendered !== null) {
      throw new Error("A personal take has no payment method and nothing tendered");
    }
  } else if (paymentMethod === null) {
    throw new Error("Payment method is required");
  }

  // Collapse duplicate product ids — same `group by product_id` the SQL did.
  const collapsed = new Map<
    string,
    { quantity: number; discountAmount: number; surchargeAmount: number }
  >();
  for (const item of items) {
    const discount = item.discountAmount ?? 0;
    const surcharge = item.surchargeAmount ?? 0;
    const existing = collapsed.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
      existing.discountAmount += discount;
      existing.surchargeAmount += surcharge;
    } else {
      collapsed.set(item.productId, {
        quantity: item.quantity,
        discountAmount: discount,
        surchargeAmount: surcharge,
      });
    }
  }
  const cart = [...collapsed.entries()].map(([productId, v]) => ({ productId, ...v }));

  for (const line of cart) {
    if (
      !line.productId ||
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isFinite(line.discountAmount) ||
      line.discountAmount < 0 ||
      !Number.isFinite(line.surchargeAmount) ||
      line.surchargeAmount < 0
    ) {
      throw new Error(
        "Each cart line needs a product_id, a quantity of at least 1, a non-negative discount, and a non-negative surcharge"
      );
    }
  }

  // Lock every referenced product, in a stable order, before any write —
  // avoids deadlocks when two concurrent sales share products.
  const productIds = [...cart.map((l) => l.productId)].sort();
  const products = await queryConn<{ id: string; name: string; price: number; cost: number | null }>(
    conn,
    `SELECT id, name, price, cost FROM products WHERE id IN (${placeholders(productIds.length)}) ORDER BY id FOR UPDATE`,
    productIds
  );

  if (products.length !== cart.length) {
    throw new Error("One or more products in the cart do not exist");
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  // A personal take has no sale price and no discount/surcharge to speak
  // of — nothing was sold, so it's valued at what it actually cost the
  // store to stock, not what it would have sold for (see checkout()'s own
  // vault-entry comment below: "no income"). A line whose product has
  // never been restocked through the app (cost unknown) is left out of the
  // total rather than guessed at via price, same "don't assume 100%" rule
  // every other cost-based figure in the app already follows — its
  // unit_cost is still stored as null on the line below, so the gap stays
  // visible rather than silently rounding down to a complete-looking
  // number.
  let total = 0;
  const lines = cart.map((line) => {
    const product = productById.get(line.productId)!;
    if (personalTake) {
      if (product.cost !== null) {
        total += roundMoney(product.cost * line.quantity);
      }
      return { ...line, product, discount: 0, surcharge: 0 };
    }
    const subtotal = roundMoney(product.price * line.quantity);
    // Rounded here (transaction_items.discount_amount/surcharge_amount are
    // both DECIMAL) rather than trusted as-is — a percent-of-subtotal
    // adjustment computed client-side can leave floating-point noise past
    // the centavo, which this app's strict-mode MariaDB rejects outright
    // instead of silently truncating (same reasoning as recordRestock's
    // cost rounding).
    const discount = roundMoney(Math.min(line.discountAmount, subtotal));
    const surcharge = roundMoney(line.surchargeAmount);
    total += subtotal + surcharge - discount;
    return { ...line, product, discount, surcharge };
  });
  total = roundMoney(total);

  if (tendered !== null) {
    if (paymentMethod !== "cash") {
      throw new Error("Amount received only applies to cash payments");
    }
    if (tendered < total) {
      throw new Error(`Amount received (${tendered}) is less than the total (${total})`);
    }
  }

  const transactionId = randomUUID();
  await conn.query(
    "INSERT INTO transactions (id, payment_method, cashier_id, total, tendered, is_personal_take, visit_id, debtor_name, debtor_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      transactionId,
      paymentMethod,
      cashierId,
      total,
      tendered,
      personalTake,
      visitId,
      debtorName,
      debtorDescription,
    ]
  );

  for (const line of lines) {
    await conn.query(
      "INSERT INTO transaction_items (id, transaction_id, product_id, product_name, unit_price, unit_cost, quantity, discount_amount, surcharge_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        randomUUID(),
        transactionId,
        line.product.id,
        line.product.name,
        line.product.price,
        line.product.cost,
        line.quantity,
        line.discount,
        line.surcharge,
      ]
    );
    await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [
      line.quantity,
      line.productId,
    ]);
  }

  // Personal takes deduct stock like any sale, but post no income: nothing
  // was sold, so nothing enters the vault. A fully-discounted sale (total =
  // 0) posts nothing either — vault_entries' own CHECK requires amount > 0
  // for a 'sale' row.
  if (!personalTake && total > 0) {
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, created_by) VALUES (?, 'sale', ?, ?, ?, ?)",
      [randomUUID(), total, transactionId, paymentMethod, cashierId]
    );
  }

  return transactionId;
}
