import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";

import { withTransaction } from "@/lib/mysql/pool";
import { allocatePayment } from "@/lib/personalTakes";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/** One debt a payment can be applied to — a cart taken on utang
    (`transactions`) or an e-service taken on utang
    (`service_transactions`). */
export type TakeRef = { kind: "sale" | "service"; id: string };

export type TakeBalance = TakeRef & {
  /** What this debt is owed at — cost (or selling price, if the take is
      flagged for it) for a cart, principal + fee for a service. */
  owed: number;
  /** Already paid, summed from the deposits previously posted against it,
      so it can never drift away from what the vault actually recorded. */
  paid: number;
  remaining: number;
  createdAt: string;
};

export type TakePaymentResult = {
  applied: number;
  /** Anything the selected debts couldn't absorb — the caller rejects a
      payment larger than the balance before it gets here, so this is only
      ever a rounding guard. */
  unapplied: number;
  settled: TakeRef[];
};

/** Reads a cart take's owed/paid, locking the row for the rest of the
    transaction. `settle_at_selling_price` decides which figure it's owed
    at; the selling figure is recomputed from the line snapshots rather
    than trusted from the client, never from what the sheet displayed. */
async function loadSaleBalance(
  conn: PoolConnection,
  id: string
): Promise<TakeBalance & { costOwed: number }> {
  const rows = await queryConn<{
    is_personal_take: boolean;
    total: number;
    settle_at_selling_price: boolean;
    voided_at: string | null;
    created_at: string;
  }>(
    conn,
    `SELECT is_personal_take, total, settle_at_selling_price, voided_at, created_at
     FROM transactions WHERE id = ? FOR UPDATE`,
    [id]
  );
  const take = rows[0];
  if (!take) throw new Error("Take not found");
  if (!take.is_personal_take) throw new Error("Only a personal take can be paid");
  if (take.voided_at !== null) {
    throw new Error("This take was voided — there's nothing to pay");
  }

  const costOwed = roundMoney(Number(take.total));
  let owed = costOwed;
  if (take.settle_at_selling_price) {
    // line_total, not unit_price × quantity — it's the generated column
    // that already nets out any discount/surcharge put on the line, which
    // IS what the debtor is being charged (see checkout()'s take branch).
    const itemRows = await queryConn<{ line_total: number }>(
      conn,
      "SELECT line_total FROM transaction_items WHERE transaction_id = ?",
      [id]
    );
    owed = roundMoney(
      itemRows.reduce((sum, item) => sum + Number(item.line_total ?? 0), 0)
    );
  }

  const paidRows = await queryConn<{ paid: number }>(
    conn,
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM vault_entries
     WHERE transaction_id = ? AND entry_type = 'deposit'`,
    [id]
  );
  const paid = roundMoney(Number(paidRows[0]?.paid ?? 0));
  return {
    kind: "sale",
    id,
    owed,
    costOwed,
    paid,
    remaining: roundMoney(Math.max(0, owed - paid)),
    createdAt: take.created_at,
  };
}

/** The service twin — a service take is owed exactly principal + fee (see
    recordService's own take handling), with no cost/selling choice. */
async function loadServiceBalance(
  conn: PoolConnection,
  id: string
): Promise<TakeBalance & { principal: number }> {
  const rows = await queryConn<{
    is_personal_take: boolean;
    principal: number;
    fee: number;
    voided_at: string | null;
    created_at: string;
  }>(
    conn,
    `SELECT is_personal_take, principal, fee, voided_at, created_at
     FROM service_transactions WHERE id = ? FOR UPDATE`,
    [id]
  );
  const take = rows[0];
  if (!take) throw new Error("Take not found");
  if (!take.is_personal_take) throw new Error("Only a personal take can be paid");
  if (take.voided_at !== null) {
    throw new Error("This take was voided — there's nothing to pay");
  }

  const principal = roundMoney(Number(take.principal));
  const owed = roundMoney(principal + Number(take.fee));
  const paidRows = await queryConn<{ paid: number }>(
    conn,
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM vault_entries
     WHERE service_transaction_id = ? AND entry_type = 'deposit'`,
    [id]
  );
  const paid = roundMoney(Number(paidRows[0]?.paid ?? 0));
  return {
    kind: "service",
    id,
    owed,
    principal,
    paid,
    remaining: roundMoney(Math.max(0, owed - paid)),
    createdAt: take.created_at,
  };
}

/** How much of `amount` falls below `threshold` given `alreadyPaid` has
    been applied first — the "recover cost before booking profit" split,
    applied to a partial payment instead of a whole one. */
function portionBelow(
  alreadyPaid: number,
  amount: number,
  threshold: number
): number {
  const before = Math.min(alreadyPaid, threshold);
  const after = Math.min(alreadyPaid + amount, threshold);
  return roundMoney(Math.max(0, after - before));
}

/**
 * Records one payment against one or more personal takes — the single
 * money-in path for utang, replacing the old all-or-nothing settle.
 *
 * The payment is applied oldest debt first until it runs out, so a ₱500
 * payment against a ₱1,000 debt leaves ₱500 outstanding rather than
 * closing it. Each debt gets its own 'deposit' vault entry for exactly the
 * part applied to it, which is also what paid-to-date is read back from
 * (see loadSaleBalance) — there's no separate "amount paid" column to
 * drift away from what the vault says.
 *
 * Within one debt the split follows the same rule a full settlement always
 * did, just prorated: the store recovers its own cost first (a cart's
 * 'reinvest' fund, a service's unfunded pass-through principal), and only
 * what's paid ABOVE that counts as 'profit'. So a half payment on a take
 * being settled at cost books no profit at all, and profit only starts
 * once the cost is fully back.
 *
 * A debt is marked settled the moment its balance reaches zero.
 */
export async function recordTakePayment(
  params: {
    takes: TakeRef[];
    amount: number;
    account: MoneyAccount;
    debtorName?: string | null;
    debtorDescription?: string | null;
  },
  userId: string
): Promise<TakePaymentResult> {
  const { account } = params;
  const amount = roundMoney(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment must be more than 0");
  }
  if (params.takes.length === 0) {
    throw new Error("Pick at least one take to pay");
  }

  const debtorName = params.debtorName?.trim() || null;
  const debtorDescription = params.debtorDescription?.trim() || null;

  return withTransaction(async (conn) => {
    // Locked and read in a stable order (sale ids then service ids, each
    // sorted) before anything is written — same deadlock-avoidance
    // discipline checkout()/recordBulkRestock already follow.
    const ordered = [...params.takes].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    );
    const balances: (TakeBalance & { costOwed?: number; principal?: number })[] = [];
    for (const take of ordered) {
      balances.push(
        take.kind === "sale"
          ? await loadSaleBalance(conn, take.id)
          : await loadServiceBalance(conn, take.id)
      );
    }

    const totalRemaining = roundMoney(
      balances.reduce((sum, balance) => sum + balance.remaining, 0)
    );
    if (totalRemaining <= 0) {
      throw new Error("Those takes are already fully paid");
    }
    if (amount > totalRemaining) {
      throw new Error(
        `That's more than what's owed on the selected takes (${totalRemaining.toFixed(2)})`
      );
    }

    // Oldest first — a debtor chipping away at several utangs clears the
    // ones they've owed longest, which is what both sides expect. Shared
    // with the sheet's own review step so what the owner confirms is
    // exactly what gets recorded.
    const allocations = allocatePayment(balances, amount);

    let left = amount;
    const settled: TakeRef[] = [];
    const note = debtorName
      ? `Personal take payment — ${debtorName}`
      : "Personal take payment";

    for (const { take: balance, applied } of allocations) {
      left = roundMoney(left - applied);

      if (balance.kind === "sale") {
        // Cost first, then profit — see portionBelow.
        const reinvest = portionBelow(balance.paid, applied, balance.costOwed ?? 0);
        const profit = roundMoney(applied - reinvest);
        if (reinvest > 0) {
          await conn.query(
            "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, fund, created_by, note) VALUES (?, 'deposit', ?, ?, ?, 'reinvest', ?, ?)",
            [randomUUID(), reinvest, balance.id, account, userId, note]
          );
        }
        if (profit > 0) {
          await conn.query(
            "INSERT INTO vault_entries (id, entry_type, amount, transaction_id, account, fund, created_by, note) VALUES (?, 'deposit', ?, ?, ?, 'profit', ?, ?)",
            [randomUUID(), profit, balance.id, account, userId, note]
          );
        }
        await conn.query(
          `UPDATE transactions
           SET debtor_name = COALESCE(?, debtor_name),
               debtor_description = COALESCE(?, debtor_description)
           WHERE id = ?`,
          [debtorName, debtorDescription, balance.id]
        );
        if (roundMoney(balance.paid + applied) >= balance.owed) {
          await conn.query(
            "UPDATE transactions SET settled_at = NOW(), settled_by = ? WHERE id = ?",
            [userId, balance.id]
          );
          settled.push({ kind: "sale", id: balance.id });
        }
      } else {
        // Principal (the store's own money coming back) first, then the
        // fee — the only part of a service that was ever income.
        const principalPart = portionBelow(
          balance.paid,
          applied,
          balance.principal ?? 0
        );
        const feePart = roundMoney(applied - principalPart);
        if (principalPart > 0) {
          await conn.query(
            "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, created_by, note) VALUES (?, 'deposit', ?, ?, ?, ?, ?)",
            [randomUUID(), principalPart, balance.id, account, userId, note]
          );
        }
        if (feePart > 0) {
          await conn.query(
            "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, fund, created_by, note) VALUES (?, 'deposit', ?, ?, ?, 'profit', ?, ?)",
            [randomUUID(), feePart, balance.id, account, userId, note]
          );
        }
        await conn.query(
          `UPDATE service_transactions
           SET debtor_name = COALESCE(?, debtor_name),
               debtor_description = COALESCE(?, debtor_description)
           WHERE id = ?`,
          [debtorName, debtorDescription, balance.id]
        );
        if (roundMoney(balance.paid + applied) >= balance.owed) {
          await conn.query(
            "UPDATE service_transactions SET settled_at = NOW(), settled_by = ? WHERE id = ?",
            [userId, balance.id]
          );
          settled.push({ kind: "service", id: balance.id });
        }
      }
    }

    return { applied: roundMoney(amount - left), unapplied: left, settled };
  });
}

/**
 * Switches an unpaid cart take between being owed at cost and at what its
 * items would have sold for. Refused once any payment has landed — the
 * balance a debtor is part-way through paying can't move under them.
 */
export async function setTakeSellingPriceBasis(params: {
  transactionId: string;
  atSellingPrice: boolean;
}): Promise<void> {
  const { transactionId, atSellingPrice } = params;

  await withTransaction(async (conn) => {
    const rows = await queryConn<{
      is_personal_take: boolean;
      voided_at: string | null;
      settled_at: string | null;
    }>(
      conn,
      "SELECT is_personal_take, voided_at, settled_at FROM transactions WHERE id = ? FOR UPDATE",
      [transactionId]
    );
    const take = rows[0];
    if (!take) throw new Error("Take not found");
    if (!take.is_personal_take) {
      throw new Error("Only a personal take has an amount to choose");
    }
    if (take.voided_at !== null || take.settled_at !== null) {
      throw new Error("This take is already closed");
    }

    const paidRows = await queryConn<{ paid: number }>(
      conn,
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM vault_entries
       WHERE transaction_id = ? AND entry_type = 'deposit'`,
      [transactionId]
    );
    if (roundMoney(Number(paidRows[0]?.paid ?? 0)) > 0) {
      throw new Error(
        "Something's already been paid on this take — the amount owed can't change now"
      );
    }

    // Switching to cost on a take whose items have no recorded cost would
    // make it owed ₱0 — i.e. silently forgiven. Refuse rather than let a
    // debt evaporate on a tap (see checkout(): a take's cost-based total
    // skips any line whose product was never restocked through the app).
    if (!atSellingPrice) {
      const totalRows = await queryConn<{ total: number }>(
        conn,
        "SELECT total FROM transactions WHERE id = ?",
        [transactionId]
      );
      if (roundMoney(Number(totalRows[0]?.total ?? 0)) <= 0) {
        throw new Error(
          "This take has no recorded cost, so it can only be charged at selling price"
        );
      }
    }

    await conn.query(
      "UPDATE transactions SET settle_at_selling_price = ? WHERE id = ?",
      [atSellingPrice, transactionId]
    );
  });
}
