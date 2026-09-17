import { queryRows } from "@/lib/mysql/pool";
import { roundMoney } from "@/lib/pricing";
import type {
  MoneyAccount,
  PersonalTakeSettlement,
  TransactionWithItems,
} from "@/lib/types";

/**
 * Attaches a `settlement` to every paid personal take in `transactions`,
 * read off the 'deposit' rows settlePersonalTake posted for it (the only
 * deposits that ever carry a transaction_id). Leaves everything else
 * untouched.
 *
 * settlePersonalTake doesn't store which mode it was settled in, but the
 * deposit total gives it away: at cost it's exactly the take's own
 * cost-based `total`; at selling price it's the retail sum instead. If
 * those two happen to be equal the mode is indistinguishable — and also
 * irrelevant, since both modes then produce identical revenue and profit.
 */
export async function attachSettlements(
  transactions: TransactionWithItems[]
): Promise<TransactionWithItems[]> {
  const paid = transactions.filter((t) => t.is_personal_take && t.settled_at);
  if (paid.length === 0) return transactions;

  const rows = await queryRows<{
    transaction_id: string;
    amount: number;
    account: MoneyAccount;
  }>(
    `SELECT transaction_id, SUM(amount) AS amount, MIN(account) AS account
     FROM vault_entries
     WHERE entry_type = 'deposit'
       AND transaction_id IN (${paid.map(() => "?").join(",")})
     GROUP BY transaction_id`,
    paid.map((t) => t.id)
  );
  const byId = new Map(rows.map((row) => [row.transaction_id, row]));

  return transactions.map((t) => {
    if (!t.is_personal_take || !t.settled_at) return t;
    const row = byId.get(t.id);
    const amount = roundMoney(Number(row?.amount ?? 0));
    const settlement: PersonalTakeSettlement = {
      amount,
      account: row?.account ?? null,
      atSellingPrice: amount !== roundMoney(Number(t.total)),
    };
    return { ...t, settlement };
  });
}

/**
 * SQL for a window's store income, as one row of `store_gross` and
 * `store_margin` — the SQL twin of lib/personalTakes.ts's incomeSales, for
 * the places that total income in the database instead of in JS (the vault
 * snapshot and its preview). Regular sales count by created_at; paid
 * personal takes count by settled_at, each line worth its cost when settled
 * at cost or its line_total when settled at selling price. Settlement mode
 * is read the same way attachSettlements reads it: the deposit total
 * differs from the take's own cost-based total only at selling price.
 * Margin excludes lines with no recorded cost, same rule as everywhere else.
 *
 * `dayCondition` turns a timestamp column into a WHERE condition, e.g.
 * (col) => `DATE(${col}) = CURDATE()`. Only ever given trusted,
 * code-authored SQL — never user input.
 */
export function storeIncomeSql(dayCondition: (column: string) => string): string {
  return `
    SELECT
      COALESCE(SUM(x.revenue), 0) AS store_gross,
      COALESCE(SUM(
        CASE WHEN x.unit_cost IS NOT NULL
          THEN x.revenue - x.unit_cost * x.quantity
          ELSE 0
        END
      ), 0) AS store_margin
    FROM (
      SELECT ti.line_total AS revenue, ti.unit_cost, ti.quantity
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti.transaction_id
      WHERE t.is_personal_take = 0 AND t.voided_at IS NULL
        AND ${dayCondition("t.created_at")}
      UNION ALL
      SELECT
        CASE WHEN s.at_selling = 1
          THEN ti.line_total
          ELSE COALESCE(ROUND(ti.unit_cost * ti.quantity, 2), 0)
        END AS revenue,
        ti.unit_cost,
        ti.quantity
      FROM transaction_items ti
      JOIN (
        SELECT
          t.id,
          ROUND(COALESCE((
            SELECT SUM(ve.amount) FROM vault_entries ve
            WHERE ve.transaction_id = t.id AND ve.entry_type = 'deposit'
          ), 0), 2) <> ROUND(t.total, 2) AS at_selling
        FROM transactions t
        WHERE t.is_personal_take = 1 AND t.voided_at IS NULL
          AND t.settled_at IS NOT NULL
          AND ${dayCondition("t.settled_at")}
      ) s ON s.id = ti.transaction_id
    ) x`;
}
