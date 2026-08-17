import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { queryConn, roundMoney } from "./helpers";

export type VaultSnapshotResult = {
  day: string;
  cash: number;
  gcash: number;
  maya: number;
  totalMoney: number;
  profit: number;
};

/**
 * Records (or, if one already exists for today, overwrites) the vault's
 * whole-picture snapshot: what's physically counted across all 3 accounts
 * right now, plus how much the store has profited today so far (store
 * margin + e-service fees, same definition Statistics/Vault's Profit card
 * already use, just scoped to today instead of a filter range). Only one
 * row per store-day (vault_snapshots.snapshot_day is UNIQUE) — recording a
 * second snapshot the same day just updates that row via
 * ON DUPLICATE KEY UPDATE, so the latest count always wins instead of
 * piling up several same-day readings.
 *
 * The counted amounts are trusted input, same as recordVaultCount's
 * `counted` — a human physically checked the money, this just records what
 * they saw. `CURDATE()` (not a JS-computed date) decides which day's row
 * this belongs to, staying correct off the same pinned Manila session
 * timezone every other date-sensitive query in this app already relies on
 * (see lib/mysql/pool.ts).
 */
export async function recordVaultSnapshot(
  params: { cash: number; gcash: number; maya: number },
  cashierId: string
): Promise<VaultSnapshotResult> {
  const cash = roundMoney(params.cash);
  const gcash = roundMoney(params.gcash);
  const maya = roundMoney(params.maya);

  for (const [label, value] of [
    ["Cash", cash],
    ["GCash", gcash],
    ["Maya", maya],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} amount must be 0 or more`);
    }
  }

  const totalMoney = roundMoney(cash + gcash + maya);

  return withTransaction(async (conn) => {
    const profitRows = await queryConn<{ store_margin: number; eservice_fee: number }>(
      conn,
      `SELECT
         COALESCE((
           SELECT SUM(
             CASE WHEN ti.unit_cost IS NOT NULL
               THEN ti.line_total - ti.unit_cost * ti.quantity
               ELSE 0
             END
           )
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.transaction_id
           WHERE t.is_personal_take = 0 AND t.voided_at IS NULL
             AND DATE(t.created_at) = CURDATE()
         ), 0) AS store_margin,
         COALESCE((
           SELECT SUM(fee) FROM service_transactions
           WHERE voided_at IS NULL AND DATE(created_at) = CURDATE()
         ), 0) AS eservice_fee`
    );
    const profit = roundMoney(
      Number(profitRows[0]?.store_margin ?? 0) + Number(profitRows[0]?.eservice_fee ?? 0)
    );

    await conn.query(
      `INSERT INTO vault_snapshots
         (id, snapshot_day, cash_amount, gcash_amount, maya_amount, total_money, profit, created_by)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cash_amount = VALUES(cash_amount),
         gcash_amount = VALUES(gcash_amount),
         maya_amount = VALUES(maya_amount),
         total_money = VALUES(total_money),
         profit = VALUES(profit),
         created_by = VALUES(created_by)`,
      [randomUUID(), cash, gcash, maya, totalMoney, profit, cashierId]
    );

    const dayRows = await queryConn<{ day: string }>(conn, "SELECT CURDATE() AS day");

    return { day: dayRows[0].day, cash, gcash, maya, totalMoney, profit };
  });
}
