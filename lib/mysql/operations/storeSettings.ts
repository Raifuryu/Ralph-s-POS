import { pool } from "@/lib/mysql/pool";
import { roundMoney } from "./helpers";

/**
 * Sets (or clears, if `target` is null) the Cash+GCash+Maya total the owner
 * wants maintained — the Sales dashboard's own Baseline Fund card shows the
 * gap between this and the live total, red once the total falls short. A
 * plain upsert into the single-row store_settings table (see its own
 * comment in mariadb/schema.sql) — no separate "does a row exist yet"
 * check needed.
 */
export async function setBaselineFundTarget(
  params: { target: number | null },
  userId: string
): Promise<void> {
  const target = params.target !== null ? roundMoney(params.target) : null;
  if (target !== null && (!Number.isFinite(target) || target < 0)) {
    throw new Error("Target must be 0 or more, or left blank to clear it.");
  }

  await pool.query(
    `INSERT INTO store_settings (id, baseline_fund_target, updated_by)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE
       baseline_fund_target = VALUES(baseline_fund_target),
       updated_by = VALUES(updated_by)`,
    [target, userId]
  );
}
