import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Corrects one account's balance to a stated figure instead of asking the
 * cashier to work out the delta themselves — they type what the balance
 * should actually be (e.g. "it's 8500"), and the difference from the
 * current balance is computed here, server-side, and logged as a single
 * 'adjustment' vault_entries row. Distinct from a 'count' (which only
 * records a reading and its expected/over-short for reference) — an
 * adjustment actually corrects the balance going forward, the same way a
 * deposit/withdrawal does, just derived from a target rather than a typed
 * amount.
 */
export async function adjustVaultBalance(
  params: { account: MoneyAccount; targetBalance: number; note: string | null },
  cashierId: string
): Promise<{
  account: MoneyAccount;
  previousBalance: number;
  targetBalance: number;
  delta: number;
}> {
  const { account, note } = params;
  const targetBalance = roundMoney(params.targetBalance);

  if (!Number.isFinite(targetBalance) || targetBalance < 0) {
    throw new Error("New balance must be 0 or more");
  }

  return withTransaction(async (conn) => {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM vault_balance WHERE account = ?",
      [account]
    );
    const previousBalance = roundMoney(rows[0]?.balance ?? 0);
    const delta = roundMoney(targetBalance - previousBalance);

    if (delta === 0) {
      throw new Error("That's already the current balance — nothing to adjust.");
    }

    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, created_by, note) VALUES (?, 'adjustment', ?, ?, ?, ?)",
      [randomUUID(), delta, account, cashierId, note]
    );

    return { account, previousBalance, targetBalance, delta };
  });
}
