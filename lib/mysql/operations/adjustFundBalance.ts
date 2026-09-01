import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { ProfitFund } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Corrects one fund's balance to a stated figure — the mirror of
 * adjustVaultBalance, just targeting vault_fund_balance instead of
 * vault_balance. The cashier types what the fund's balance should actually
 * be, and the difference from its current balance is computed here,
 * server-side, and logged as a single 'adjustment' vault_entries row with
 * `fund` set. `account` is required (NOT NULL) but doesn't matter for
 * balance purposes — this row is excluded from every account's own balance
 * by having `fund` set at all (see vault_balance's own comment); 'cash' is
 * just a placeholder, same convention recordBulkRestock's fund-withdrawal
 * leg already uses.
 */
export async function adjustFundBalance(
  params: { fund: ProfitFund; targetBalance: number; note: string | null },
  cashierId: string
): Promise<{
  fund: ProfitFund;
  previousBalance: number;
  targetBalance: number;
  delta: number;
}> {
  const { fund, note } = params;
  const targetBalance = roundMoney(params.targetBalance);

  if (!Number.isFinite(targetBalance) || targetBalance < 0) {
    throw new Error("New balance must be 0 or more");
  }

  return withTransaction(async (conn) => {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM vault_fund_balance WHERE fund = ?",
      [fund]
    );
    const previousBalance = roundMoney(rows[0]?.balance ?? 0);
    const delta = roundMoney(targetBalance - previousBalance);

    if (delta === 0) {
      throw new Error("That's already the current balance — nothing to adjust.");
    }

    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, fund, created_by, note) VALUES (?, 'adjustment', ?, 'cash', ?, ?, ?)",
      [randomUUID(), delta, fund, cashierId, note]
    );

    return { fund, previousBalance, targetBalance, delta };
  });
}
