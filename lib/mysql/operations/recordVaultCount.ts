import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/** Port of record_vault_count(). Reads vault_balance for the account inside
    the same transaction as the insert, preserving the atomicity the view +
    insert had under Postgres — otherwise a concurrent movement between the
    read and the write could make "expected" stale. */
export async function recordVaultCount(
  params: { account: MoneyAccount; counted: number },
  cashierId: string
): Promise<{ account: MoneyAccount; counted: number; expected: number; overShort: number }> {
  const { account } = params;
  // Rounded here rather than trusted as-is — same reasoning as every other
  // money value in these operations (see recordRestock's cost rounding);
  // counted is typed input, lower-risk than a computed value, but cheap to
  // guard the same way regardless.
  const counted = roundMoney(params.counted);

  if (!Number.isFinite(counted) || counted < 0) {
    throw new Error("Counted amount must be 0 or more");
  }

  return withTransaction(async (conn) => {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM vault_balance WHERE account = ?",
      [account]
    );
    const expected = roundMoney(rows[0]?.balance ?? 0);

    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, expected, account, created_by) VALUES (?, 'count', ?, ?, ?, ?)",
      [randomUUID(), counted, expected, account, cashierId]
    );

    return {
      account,
      counted,
      expected,
      overShort: roundMoney(counted - expected),
    };
  });
}
