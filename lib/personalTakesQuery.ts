import { queryRows } from "@/lib/mysql/pool";
import { roundMoney } from "@/lib/pricing";
import type { MoneyAccount, TakePayment } from "@/lib/types";

/**
 * Personal takes are read back out of the vault, not out of a column.
 *
 * A take posts nothing when it happens (it's a debt, not income), and
 * every payment against it posts its own 'deposit' row carrying the
 * amount, where it landed, and — via `fund` — how much of it was profit
 * rather than cost coming back (see recordTakePayment's own split). So
 * paid-to-date, income, and the sales feed can all be derived from those
 * deposits, which means a partial payment counts for exactly what was
 * actually received, on the day it was received, with no second source of
 * truth to drift away from the vault.
 */

type TakePaymentRow = {
  transaction_id: string | null;
  service_transaction_id: string | null;
  created_at: string;
  account: MoneyAccount;
  amount: number;
  profit: number;
  debtor_name: string | null;
  service_name: string | null;
  wallet: MoneyAccount | null;
};

/** One payment against one take. A payment spread across several takes
    posts one deposit per take, so it comes back as a row each — which is
    what the feed should show anyway, since each belongs to a different
    debt. Grouped by (take, timestamp) because a single payment can post
    two rows for the same take: the cost part and the profit part. */
export async function fetchTakePayments(
  fromTs?: string,
  toTs?: string
): Promise<TakePayment[]> {
  const conditions = [
    "ve.entry_type = 'deposit'",
    "(ve.transaction_id IS NOT NULL OR ve.service_transaction_id IS NOT NULL)",
  ];
  const params: string[] = [];
  if (fromTs) {
    conditions.push("ve.created_at >= ?");
    params.push(fromTs);
  }
  if (toTs) {
    conditions.push("ve.created_at <= ?");
    params.push(toTs);
  }

  const rows = await queryRows<TakePaymentRow>(
    `SELECT
       ve.transaction_id,
       ve.service_transaction_id,
       ve.created_at,
       ve.account,
       COALESCE(SUM(ve.amount), 0) AS amount,
       COALESCE(SUM(CASE WHEN ve.fund = 'profit' THEN ve.amount ELSE 0 END), 0) AS profit,
       COALESCE(t.debtor_name, st.debtor_name) AS debtor_name,
       st.service_name,
       st.wallet
     FROM vault_entries ve
     LEFT JOIN transactions t ON t.id = ve.transaction_id
     LEFT JOIN service_transactions st ON st.id = ve.service_transaction_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY ve.transaction_id, ve.service_transaction_id, ve.created_at,
              ve.account, t.debtor_name, st.debtor_name, st.service_name, st.wallet
     ORDER BY ve.created_at DESC`,
    params
  );

  return rows.map((row) => {
    const takeKind = row.transaction_id !== null ? "sale" : "service";
    return {
      // Stable per (take, payment time) — the same pair the GROUP BY used.
      id: `${row.transaction_id ?? row.service_transaction_id}:${row.created_at}`,
      created_at: row.created_at,
      visit_id: null,
      voided_at: null,
      is_personal_take: false,
      settled_at: null,
      amount: roundMoney(Number(row.amount)),
      profit: roundMoney(Number(row.profit)),
      account: row.account,
      debtor_name: row.debtor_name,
      label: row.service_name ?? "Personal take",
      takeKind,
      wallet: takeKind === "service" ? row.wallet : null,
    } satisfies TakePayment;
  });
}

/** Splits payments into the figures the income cards report: a cart take's
    whole payment is store revenue (its profit part being whatever was paid
    above the store's own cost), while a service take's payment is income
    only for its fee part — the principal is the store's own money coming
    back, never income, exactly as when a service is paid for normally. */
export function takePaymentTotals(payments: TakePayment[]) {
  let storeRevenue = 0;
  let storeMargin = 0;
  let storeCogs = 0;
  const eServiceFees = { gcash: 0, maya: 0, other: 0 };

  for (const payment of payments) {
    if (payment.takeKind === "sale") {
      storeRevenue = roundMoney(storeRevenue + payment.amount);
      storeMargin = roundMoney(storeMargin + payment.profit);
      storeCogs = roundMoney(storeCogs + (payment.amount - payment.profit));
    } else if (payment.profit > 0) {
      const bucket =
        payment.wallet === "gcash"
          ? "gcash"
          : payment.wallet === "maya"
            ? "maya"
            : "other";
      eServiceFees[bucket] = roundMoney(eServiceFees[bucket] + payment.profit);
    }
  }

  return { storeRevenue, storeMargin, storeCogs, eServiceFees };
}

/**
 * SQL for a window's store income, as one row of `store_gross` and
 * `store_margin` — the SQL twin of takePaymentTotals, for the places that
 * total income in the database instead of in JS (the vault snapshot and
 * its preview). Normal sales count by created_at; utang counts by what was
 * actually PAID in the window, straight off the deposits.
 *
 * `dayCondition` turns a timestamp column into a WHERE condition, e.g.
 * (col) => `DATE(${col}) = CURDATE()`. Only ever given trusted,
 * code-authored SQL — never user input.
 */
export function storeIncomeSql(dayCondition: (column: string) => string): string {
  return `
    SELECT
      COALESCE(SUM(x.revenue), 0) AS store_gross,
      COALESCE(SUM(x.margin), 0) AS store_margin
    FROM (
      SELECT
        ti.line_total AS revenue,
        CASE WHEN ti.unit_cost IS NOT NULL
          THEN ti.line_total - ti.unit_cost * ti.quantity
          ELSE 0
        END AS margin
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti.transaction_id
      WHERE t.is_personal_take = 0 AND t.voided_at IS NULL
        AND ${dayCondition("t.created_at")}
      UNION ALL
      SELECT
        ve.amount AS revenue,
        CASE WHEN ve.fund = 'profit' THEN ve.amount ELSE 0 END AS margin
      FROM vault_entries ve
      WHERE ve.entry_type = 'deposit'
        AND ve.transaction_id IS NOT NULL
        AND ${dayCondition("ve.created_at")}
    ) x`;
}

/**
 * SQL for a window's e-service fee income — the service twin of
 * storeIncomeSql. A service paid for normally counts its whole fee on
 * created_at; one taken on utang counts only the fee portion of whatever
 * has actually been paid, on the day each payment landed.
 */
export function eServiceFeeSql(dayCondition: (column: string) => string): string {
  return `
    SELECT COALESCE(SUM(x.fee), 0) AS eservice_fee
    FROM (
      SELECT fee
      FROM service_transactions
      WHERE voided_at IS NULL AND is_personal_take = 0
        AND ${dayCondition("created_at")}
      UNION ALL
      SELECT ve.amount AS fee
      FROM vault_entries ve
      WHERE ve.entry_type = 'deposit'
        AND ve.service_transaction_id IS NOT NULL
        AND ve.fund = 'profit'
        AND ${dayCondition("ve.created_at")}
    ) x`;
}
