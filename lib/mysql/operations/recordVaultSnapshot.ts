import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

export type VaultSnapshotTargetDay = "today" | "yesterday";

export type VaultSnapshotResult = {
  day: string;
  cash: number;
  gcash: number;
  maya: number;
  totalMoney: number;
  profit: number;
  income: number;
};

/**
 * Records (or, if one already exists for the target day, overwrites) the
 * vault's whole-picture snapshot — no manual entry: the 3 account balances
 * are read straight from vault_balance (the same system-computed figures
 * the account cards themselves show), not typed in by whoever taps the
 * button. Paired with how much the store has made so far that day, both as
 * profit (store margin + e-service fees, same definition Statistics/
 * Vault's Profit card already use) and as gross income (store revenue +
 * e-service fees, before cost) — the same margin/gross split
 * app/vault/page.tsx's own live preview cards already compute, just also
 * persisted here so History rows can show a real "income" figure instead of
 * only profit.
 *
 * `targetDay` exists for exactly one case: recording last night's close
 * after midnight has already rolled the calendar over — the balances read
 * here are always the CURRENT live ones (there's no way to reconstruct an
 * exact historical balance-as-of-a-past-moment from vault_balance), so
 * "yesterday" only produces a correct snapshot if nothing's happened yet
 * today (see the caller's own warning copy in VaultSnapshotSheet). Every
 * date-sensitive comparison below uses the SAME resolved day consistently —
 * either CURDATE() or CURDATE() - INTERVAL 1 DAY, never a mix — so the
 * income/profit figures always match whichever day the row itself is filed
 * under.
 *
 * Only one row per store-day (vault_snapshots.snapshot_day is UNIQUE) —
 * recording a second snapshot for the same target day just updates that row
 * via ON DUPLICATE KEY UPDATE, so the latest tap always wins instead of
 * piling up several same-day readings. The day itself is resolved in SQL
 * (`CURDATE()`/`CURDATE() - INTERVAL 1 DAY`, not a JS-computed date),
 * staying correct off the same pinned Manila session timezone every other
 * date-sensitive query in this app already relies on (see lib/mysql/pool.ts).
 */
export async function recordVaultSnapshot(
  targetDay: VaultSnapshotTargetDay,
  cashierId: string
): Promise<VaultSnapshotResult> {
  // Interpolated, not bound as a `?` param — safe here since it only ever
  // comes from the VaultSnapshotTargetDay union (never raw user input), and
  // a bound date parameter can't be reused as a SQL date expression inside
  // both DATE(...) comparisons and the INSERT's own column value the way a
  // plain expression can.
  const dayExpr = targetDay === "yesterday" ? "(CURDATE() - INTERVAL 1 DAY)" : "CURDATE()";

  return withTransaction(async (conn) => {
    const balanceRows = await queryConn<{ account: MoneyAccount; balance: number }>(
      conn,
      "SELECT account, balance FROM vault_balance"
    );
    const balances = new Map(
      balanceRows.map((row) => [row.account, roundMoney(Number(row.balance ?? 0))])
    );
    const cash = balances.get("cash") ?? 0;
    const gcash = balances.get("gcash") ?? 0;
    const maya = balances.get("maya") ?? 0;
    const totalMoney = roundMoney(cash + gcash + maya);

    const incomeRows = await queryConn<{
      store_gross: number;
      store_margin: number;
      eservice_fee: number;
    }>(
      conn,
      `SELECT
         COALESCE((
           SELECT SUM(ti.line_total)
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.transaction_id
           WHERE t.is_personal_take = 0 AND t.voided_at IS NULL
             AND DATE(t.created_at) = ${dayExpr}
         ), 0) AS store_gross,
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
             AND DATE(t.created_at) = ${dayExpr}
         ), 0) AS store_margin,
         COALESCE((
           SELECT SUM(fee) FROM service_transactions
           WHERE voided_at IS NULL AND DATE(created_at) = ${dayExpr}
         ), 0) AS eservice_fee`
    );
    const storeGross = Number(incomeRows[0]?.store_gross ?? 0);
    const storeMargin = Number(incomeRows[0]?.store_margin ?? 0);
    const eServiceFee = Number(incomeRows[0]?.eservice_fee ?? 0);
    // E-service has no separate "gross before cost" — the fee itself is
    // already 100% margin (no COGS to subtract), same reasoning
    // IncomeBreakdownCard/app/vault/page.tsx already apply.
    const income = roundMoney(storeGross + eServiceFee);
    const profit = roundMoney(storeMargin + eServiceFee);

    await conn.query(
      `INSERT INTO vault_snapshots
         (id, snapshot_day, cash_amount, gcash_amount, maya_amount, total_money, profit, income, created_by)
       VALUES (?, ${dayExpr}, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cash_amount = VALUES(cash_amount),
         gcash_amount = VALUES(gcash_amount),
         maya_amount = VALUES(maya_amount),
         total_money = VALUES(total_money),
         profit = VALUES(profit),
         income = VALUES(income),
         created_by = VALUES(created_by)`,
      [randomUUID(), cash, gcash, maya, totalMoney, profit, income, cashierId]
    );

    const dayRows = await queryConn<{ day: string }>(
      conn,
      `SELECT ${dayExpr} AS day`
    );

    return { day: dayRows[0].day, cash, gcash, maya, totalMoney, profit, income };
  });
}
