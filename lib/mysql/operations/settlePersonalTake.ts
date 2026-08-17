import { randomUUID } from "node:crypto";

import { pool, queryRows, withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Labels a personal take ("Utang") with who took it and why, without
 * settling it — the owner might only learn/remember the debtor's name a
 * while after the take itself, or want to update a description later.
 * Plain pool query, no transaction needed: a single UPDATE with nothing
 * else to keep atomic alongside it (contrast settlePersonalTake below,
 * which also posts a vault entry in the same transaction).
 */
export async function labelPersonalTake(params: {
  transactionId: string;
  debtorName: string | null;
  debtorDescription: string | null;
}): Promise<void> {
  const { transactionId, debtorName, debtorDescription } = params;

  const rows = await queryRows<{ is_personal_take: boolean }>(
    "SELECT is_personal_take FROM transactions WHERE id = ?",
    [transactionId]
  );
  const transaction = rows[0];
  if (!transaction) throw new Error("Transaction not found");
  if (!transaction.is_personal_take) {
    throw new Error("Only a personal take can be labeled with a debtor");
  }

  await pool.query(
    "UPDATE transactions SET debtor_name = ?, debtor_description = ? WHERE id = ?",
    [debtorName, debtorDescription, transactionId]
  );
}

/**
 * New feature, no PL/pgSQL predecessor — marks a personal take as paid
 * back, in one transaction:
 * 1. Saves/updates the debtor name + description alongside it (same as
 *    labelPersonalTake, just inline here so labeling and settling can
 *    happen in the same tap rather than requiring two separate saves).
 * 2. Posts a 'deposit' vault_entries row for the settlement amount, into
 *    whichever account the debtor actually paid into — this is the first
 *    time a personal take's value ever reaches the vault; at the time it
 *    was taken, checkout() deliberately posted nothing (see its own "no
 *    income" comment).
 *
 * The settlement amount is either the take's own `total` (what it cost the
 * store — the default) or, when atSellingPrice is set, what its items would
 * have sold for — some debtors pay back the full retail price rather than
 * just reimbursing cost. Either way it's recomputed here from the take's own
 * transaction_items (unit_price is a snapshot from the moment of the
 * original take, same column checkout() itself writes it from — not
 * products' current price, which may have changed since), never trusted as
 * a client-submitted number.
 *
 * Locks the transaction row first — same discipline voidTransaction/
 * voidServiceTransaction already follow before mutating a transaction that
 * might be concurrently modified (e.g. voided) from another tab.
 */
export async function settlePersonalTake(
  params: {
    transactionId: string;
    debtorName: string | null;
    debtorDescription: string | null;
    account: MoneyAccount;
    atSellingPrice?: boolean;
  },
  userId: string
): Promise<void> {
  const { transactionId, debtorName, debtorDescription, account, atSellingPrice } =
    params;

  await withTransaction(async (conn) => {
    const rows = await queryConn<{
      is_personal_take: boolean;
      total: number;
      voided_at: string | null;
      settled_at: string | null;
    }>(
      conn,
      "SELECT is_personal_take, total, voided_at, settled_at FROM transactions WHERE id = ? FOR UPDATE",
      [transactionId]
    );
    const transaction = rows[0];
    if (!transaction) throw new Error("Transaction not found");
    if (!transaction.is_personal_take) {
      throw new Error("Only a personal take can be settled");
    }
    if (transaction.voided_at !== null) {
      throw new Error("This take was voided — there's nothing to settle");
    }
    if (transaction.settled_at !== null) {
      throw new Error("This take has already been settled");
    }

    let amount = transaction.total;
    if (atSellingPrice) {
      const itemRows = await queryConn<{ unit_price: number; quantity: number }>(
        conn,
        "SELECT unit_price, quantity FROM transaction_items WHERE transaction_id = ?",
        [transactionId]
      );
      amount = roundMoney(
        itemRows.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0)
      );
    }

    await conn.query(
      "UPDATE transactions SET debtor_name = ?, debtor_description = ?, settled_at = NOW(), settled_by = ? WHERE id = ?",
      [debtorName, debtorDescription, userId, transactionId]
    );

    const suffix = atSellingPrice ? " (selling price)" : "";
    const note = debtorName
      ? `Personal take settled${suffix} — ${debtorName}`
      : `Personal take settled${suffix}`;
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, created_by, note) VALUES (?, 'deposit', ?, ?, ?, ?, ?)",
      [randomUUID(), amount, transactionId, account, userId, note]
    );
  });
}
