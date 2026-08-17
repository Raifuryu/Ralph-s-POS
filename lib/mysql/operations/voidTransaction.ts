import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn } from "./helpers";

/** Port of void_transaction(). Restores stock via a single multi-table
    UPDATE...JOIN (MariaDB's equivalent of the original's UPDATE...FROM),
    then posts a reversing 'void' vault_entries row — but only when the
    original sale actually posted one: a fully-discounted sale (total = 0)
    or a personal take never did, so voiding either must not try to reverse
    a row that was never created (vault_entries' own CHECK requires
    amount <> 0 for a 'void' row). */
export async function voidTransaction(
  params: { transactionId: string; reason?: string | null },
  userId: string
): Promise<void> {
  const { transactionId } = params;
  const reason = params.reason?.trim() || null;

  await withTransaction(async (conn) => {
    const rows = await queryConn<{
      voided_at: string | null;
      is_personal_take: boolean;
      total: number;
      payment_method: MoneyAccount | null;
      settled_at: string | null;
    }>(
      conn,
      "SELECT voided_at, is_personal_take, total, payment_method, settled_at FROM transactions WHERE id = ? FOR UPDATE",
      [transactionId]
    );
    const transaction = rows[0];
    if (!transaction) throw new Error("Transaction not found");
    if (transaction.voided_at !== null) {
      throw new Error("This transaction has already been voided");
    }
    // A settled personal take already has its own vault deposit recording
    // the debtor's payment (see settlePersonalTake) — voiding the take now
    // wouldn't touch that deposit (the block below never reverses vault
    // entries for a personal take), leaving money on record for a take
    // that's supposedly never happened. Simplest correct rule: it's already
    // resolved, so there's nothing left to void.
    if (transaction.is_personal_take && transaction.settled_at !== null) {
      throw new Error(
        "This take has already been settled (paid back) — it can't be voided anymore"
      );
    }

    await conn.query(
      "UPDATE transactions SET voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?",
      [userId, reason, transactionId]
    );

    await conn.query(
      `UPDATE products p
       JOIN transaction_items ti ON ti.product_id = p.id
       SET p.stock = p.stock + ti.quantity
       WHERE ti.transaction_id = ?`,
      [transactionId]
    );

    if (!transaction.is_personal_take && transaction.total > 0) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, created_by, note) VALUES (?, 'void', ?, ?, ?, ?, ?)",
        [randomUUID(), -transaction.total, transactionId, transaction.payment_method, userId, "Void reversal"]
      );
    }
  });
}
