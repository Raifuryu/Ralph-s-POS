import { pool, queryRows } from "@/lib/mysql/pool";

/**
 * Labels a personal take ("Utang") with who took it and why, without
 * settling it — the owner might only learn/remember the debtor's name a
 * while after the take itself, or want to update a description later.
 * Plain pool query, no transaction needed: a single UPDATE with nothing
 * else to keep atomic alongside it (contrast recordTakePayment, which
 * also posts vault entries in the same transaction).
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
