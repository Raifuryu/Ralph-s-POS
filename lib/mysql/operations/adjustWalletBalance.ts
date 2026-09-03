import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { queryConn, roundMoney } from "./helpers";

/**
 * Corrects one wallet's balance to a stated figure — the mirror of
 * adjustFundBalance, targeting wallet_balance instead of vault_fund_balance.
 * `account` is required (NOT NULL) but doesn't matter for balance purposes
 * — this row is excluded from every account's own balance by having
 * `wallet_id` set at all (see vault_balance's own comment); 'cash' is just a
 * placeholder, same convention every other wallet/fund-tagged row uses.
 */
export async function adjustWalletBalance(
  params: { walletId: string; targetBalance: number; note: string | null },
  cashierId: string
): Promise<{
  walletId: string;
  previousBalance: number;
  targetBalance: number;
  delta: number;
}> {
  const { walletId, note } = params;
  const targetBalance = roundMoney(params.targetBalance);

  if (!Number.isFinite(targetBalance) || targetBalance < 0) {
    throw new Error("New balance must be 0 or more");
  }

  return withTransaction(async (conn) => {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM wallet_balance WHERE wallet_id = ?",
      [walletId]
    );
    const previousBalance = roundMoney(rows[0]?.balance ?? 0);
    const delta = roundMoney(targetBalance - previousBalance);

    if (delta === 0) {
      throw new Error("That's already the current balance — nothing to adjust.");
    }

    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, created_by, note) VALUES (?, 'adjustment', ?, 'cash', ?, ?, ?)",
      [randomUUID(), delta, walletId, cashierId, note]
    );

    return { walletId, previousBalance, targetBalance, delta };
  });
}
