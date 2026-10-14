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

    // Same fund split reasoning as checkout()'s own sale posting: at cost
    // (the default), the whole settlement is pure cost recovery — 100%
    // 'reinvest', nothing to 'profit'. At selling price, whatever's above
    // the take's own cost-based total IS real profit (the debtor paid full
    // retail instead of just reimbursing cost), so that excess goes to
    // 'profit' while the cost portion still goes to 'reinvest'.
    // reinvestPortion is capped at `amount` for the same reason checkout()
    // caps it at `total` — full cost recovery takes priority over showing
    // a profit that isn't really there.
    const reinvestPortion = roundMoney(Math.min(transaction.total, amount));
    const profitPortion = roundMoney(amount - reinvestPortion);
    if (reinvestPortion > 0) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, fund, created_by, note) VALUES (?, 'deposit', ?, ?, ?, 'reinvest', ?, ?)",
        [randomUUID(), reinvestPortion, transactionId, account, userId, note]
      );
    }
    if (profitPortion > 0) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, fund, created_by, note) VALUES (?, 'deposit', ?, ?, ?, 'profit', ?, ?)",
        [randomUUID(), profitPortion, transactionId, account, userId, note]
      );
    }
  });
}

/**
 * The service twin of labelPersonalTake — same "name the debtor later"
 * affordance, for a take recorded against an e-service instead of a cart.
 */
export async function labelServiceTake(params: {
  serviceTransactionId: string;
  debtorName: string | null;
  debtorDescription: string | null;
}): Promise<void> {
  const { serviceTransactionId, debtorName, debtorDescription } = params;

  const rows = await queryRows<{ is_personal_take: boolean }>(
    "SELECT is_personal_take FROM service_transactions WHERE id = ?",
    [serviceTransactionId]
  );
  const serviceTransaction = rows[0];
  if (!serviceTransaction) throw new Error("Service transaction not found");
  if (!serviceTransaction.is_personal_take) {
    throw new Error("Only a personal take can be labeled with a debtor");
  }

  await pool.query(
    "UPDATE service_transactions SET debtor_name = ?, debtor_description = ? WHERE id = ?",
    [debtorName, debtorDescription, serviceTransactionId]
  );
}

/**
 * The service twin of settlePersonalTake — marks an e-service taken on
 * utang as paid back, in one transaction.
 *
 * The debt is always principal + fee: recordService posted only what
 * actually left the store for a take (the load it sent, or the cash it
 * handed out) and nothing incoming, so this is the first time any of it
 * reaches the vault. There's no cost-vs-selling-price choice the way a
 * product take has — a service has no COGS, just a pass-through principal
 * and a fee — so the deposit splits exactly the way recordService's own
 * posting does: the fee is 100% 'profit', the principal is tagged with no
 * fund at all, since recovering the customer's own money was never income.
 */
export async function settleServiceTake(
  params: {
    serviceTransactionId: string;
    debtorName: string | null;
    debtorDescription: string | null;
    account: MoneyAccount;
  },
  userId: string
): Promise<void> {
  const { serviceTransactionId, debtorName, debtorDescription, account } = params;

  await withTransaction(async (conn) => {
    const rows = await queryConn<{
      is_personal_take: boolean;
      principal: number;
      fee: number;
      service_name: string;
      voided_at: string | null;
      settled_at: string | null;
    }>(
      conn,
      `SELECT is_personal_take, principal, fee, service_name, voided_at, settled_at
       FROM service_transactions WHERE id = ? FOR UPDATE`,
      [serviceTransactionId]
    );
    const serviceTransaction = rows[0];
    if (!serviceTransaction) throw new Error("Service transaction not found");
    if (!serviceTransaction.is_personal_take) {
      throw new Error("Only a personal take can be settled");
    }
    if (serviceTransaction.voided_at !== null) {
      throw new Error("This take was voided — there's nothing to settle");
    }
    if (serviceTransaction.settled_at !== null) {
      throw new Error("This take has already been settled");
    }

    await conn.query(
      `UPDATE service_transactions
       SET debtor_name = ?, debtor_description = ?, settled_at = NOW(), settled_by = ?
       WHERE id = ?`,
      [debtorName, debtorDescription, userId, serviceTransactionId]
    );

    const note = debtorName
      ? `Service take settled — ${debtorName}`
      : "Service take settled";
    const principal = roundMoney(Number(serviceTransaction.principal));
    const fee = roundMoney(Number(serviceTransaction.fee));

    if (principal > 0) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, created_by, note) VALUES (?, 'deposit', ?, ?, ?, ?, ?)",
        [randomUUID(), principal, serviceTransactionId, account, userId, note]
      );
    }
    if (fee > 0) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, fund, created_by, note) VALUES (?, 'deposit', ?, ?, ?, 'profit', ?, ?)",
        [randomUUID(), fee, serviceTransactionId, account, userId, note]
      );
    }
  });
}
