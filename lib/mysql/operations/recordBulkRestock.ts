import { randomUUID } from "node:crypto";

import { formatPeso } from "@/lib/format";
import { withTransaction } from "@/lib/mysql/pool";
import {
  isMoneyAccount,
  isProfitFund,
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
} from "@/lib/types";
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

/** Where a restock's payment came from — either of the two Vault funds, an
    owner-created wallet (both deducted directly, no transfer needed first:
    buying stock is literally what Reinvest — and any wallet — exists for),
    or a physical account (a plain, ordinary withdrawal). See
    vault_entries.fund/wallet_id's own comments in mariadb/schema.sql for why
    a fund/wallet can be spent from without ever touching cash/gcash/maya.
    Deliberately a plain string, not a discriminated union — a wallet's id is
    an open-ended UUID, not a fixed literal like MoneyAccount/ProfitFund, so
    there's no closed type to union it into; `isProfitFund`/`isMoneyAccount`
    below tell the two fixed kinds apart, and anything left over is treated
    as a wallet id (the FK on vault_entries.wallet_id rejects a bogus one). */
export type RestockPaymentSource = string;
export type RestockPaymentSplit = { source: RestockPaymentSource; amount: number };

/** Port of record_bulk_restock(). Every line either restocks + re-prices an
    existing product (product_id set) or creates one and restocks it in the
    same step (product_id null) — every line always restocks, there's no
    "register without stocking" shortcut anymore (see this file's own
    history: that shortcut was how a product could end up with an unknown
    cost, which then had to be special-cased in every profit figure
    downstream). Line-shape validation is re-implemented here as plain TS
    checks in the same order the original SQL ran them (each with its own
    EXISTS check), so the first violation found produces the same error
    message a caller would have seen before.
 *
 * `payment` is optional and covers the WHOLE batch, not per line — one
 * combined split across however many sources the owner picked (e.g. ₱300
 * from Reinvest + ₱200 topped off from Cash once Reinvest alone fell
 * short), deducted for real from each source. It doesn't have to add up to
 * the batch's total cost: whatever isn't attributed to a source is simply
 * left with no vault effect at all, same as omitting `payment` entirely —
 * this is a bookkeeping aid, not a hard requirement to reconcile every
 * peso spent. */
export async function recordBulkRestock(
  params: { items: BulkRestockLine[]; payment?: RestockPaymentSplit[] },
  cashierId: string
): Promise<{ items: { productId: string; restockId: string }[]; totalCost: number }> {
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

  // Collapse duplicate sources — picking the same source twice in the split
  // form dedupes rather than errors, same convention transferFund/checkout
  // already follow for their own duplicate-entry cases.
  const paymentSplits = new Map<RestockPaymentSource, number>();
  for (const split of params.payment ?? []) {
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each payment amount must be more than 0");
    }
    paymentSplits.set(
      split.source,
      roundMoney((paymentSplits.get(split.source) ?? 0) + amount)
    );
  }
  const totalCost = roundMoney(items.reduce((sum, line) => sum + line.cost, 0));
  const totalPaid = roundMoney(
    [...paymentSplits.values()].reduce((sum, amount) => sum + amount, 0)
  );
  if (totalPaid > totalCost) {
    throw new Error(
      `The payment split (${formatPeso(totalPaid)}) is more than the batch's total cost (${formatPeso(totalCost)})`
    );
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

    // Payment, one withdrawal-style row per source — checked against that
    // exact source's own current balance inside this same transaction, same
    // "no row to lock, so read-then-validate right here" tradeoff
    // transferFund/adjustVaultBalance already accept at this app's scale.
    // Every 'withdrawal' needs a note (vault_entries' own CHECK), so one's
    // always supplied here regardless of what the caller passed in.
    for (const [source, amount] of paymentSplits) {
      if (isProfitFund(source)) {
        const rows = await queryConn<{ balance: number }>(
          conn,
          "SELECT balance FROM vault_fund_balance WHERE fund = ?",
          [source]
        );
        const balance = roundMoney(rows[0]?.balance ?? 0);
        if (amount > balance) {
          throw new Error(
            `${PROFIT_FUND_LABELS[source]} only has ${formatPeso(balance)} available`
          );
        }
        // `account` is required (NOT NULL) but doesn't matter for balance
        // purposes here — this row is excluded from every account's balance
        // by having `fund` set at all (see vault_balance's own comment).
        // 'cash' is just a placeholder value, same reasoning
        // transferFund's fund-leaving leg already uses.
        await conn.query(
          "INSERT INTO vault_entries (id, entry_type, amount, account, fund, created_by, note) VALUES (?, 'withdrawal', ?, 'cash', ?, ?, ?)",
          [randomUUID(), -amount, source, cashierId, "Restock payment"]
        );
      } else if (isMoneyAccount(source)) {
        const rows = await queryConn<{ balance: number }>(
          conn,
          "SELECT balance FROM vault_balance WHERE account = ?",
          [source]
        );
        const balance = roundMoney(rows[0]?.balance ?? 0);
        if (amount > balance) {
          throw new Error(
            `${MONEY_ACCOUNT_LABELS[source]} only has ${formatPeso(balance)} available`
          );
        }
        await conn.query(
          "INSERT INTO vault_entries (id, entry_type, amount, account, created_by, note) VALUES (?, 'withdrawal', ?, ?, ?, ?)",
          [randomUUID(), -amount, source, cashierId, "Restock payment"]
        );
      } else {
        // Anything left over is a wallet id — same placeholder convention
        // as the fund branch above (see wallet_id's own comment). A bogus
        // id (neither a real fund/account literal nor a real wallet) is
        // caught by the FK on vault_entries.wallet_id itself.
        const rows = await queryConn<{ balance: number; name: string }>(
          conn,
          "SELECT balance, name FROM wallet_balance WHERE wallet_id = ?",
          [source]
        );
        const balance = roundMoney(rows[0]?.balance ?? 0);
        if (amount > balance) {
          throw new Error(
            `${rows[0]?.name ?? "That wallet"} only has ${formatPeso(balance)} available`
          );
        }
        await conn.query(
          "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, created_by, note) VALUES (?, 'withdrawal', 'cash', ?, ?, ?, ?)",
          [randomUUID(), -amount, source, cashierId, "Restock payment"]
        );
      }
    }

    return { items: result, totalCost };
  });
}
