import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn } from "./helpers";

/** Port of void_service_transaction(). Reverses every vault_entries row
    originally posted for this service transaction (there can be one or
    two — e.g. a principal+fee row and a separate wallet row), each with
    its own reversing 'void' entry, same as the original INSERT...SELECT. */
export async function voidServiceTransaction(
  params: { serviceTransactionId: string; reason?: string | null },
  userId: string
): Promise<void> {
  const { serviceTransactionId } = params;
  const reason = params.reason?.trim() || null;

  await withTransaction(async (conn) => {
    const rows = await queryConn<{ voided_at: string | null }>(
      conn,
      "SELECT voided_at FROM service_transactions WHERE id = ? FOR UPDATE",
      [serviceTransactionId]
    );
    const serviceTransaction = rows[0];
    if (!serviceTransaction) throw new Error("Service transaction not found");
    if (serviceTransaction.voided_at !== null) {
      throw new Error("This service transaction has already been voided");
    }

    await conn.query(
      "UPDATE service_transactions SET voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?",
      [userId, reason, serviceTransactionId]
    );

    const original = await queryConn<{
      amount: number;
      account: MoneyAccount;
      fund: "profit" | "reinvest" | null;
    }>(
      conn,
      "SELECT amount, account, fund FROM vault_entries WHERE service_transaction_id = ?",
      [serviceTransactionId]
    );
    for (const entry of original) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, fund, created_by, note) VALUES (?, 'void', ?, ?, ?, ?, ?, ?)",
        [
          randomUUID(),
          -entry.amount,
          serviceTransactionId,
          entry.account,
          entry.fund,
          userId,
          "Void reversal",
        ]
      );
    }
  });
}
