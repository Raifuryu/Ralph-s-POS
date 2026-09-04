import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";

import { withTransaction } from "@/lib/mysql/pool";
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

export type CounterDestination =
  | { type: "account"; account: MoneyAccount }
  | { type: "wallet"; walletId: string }
  | { type: "fund"; fund: ProfitFund };

export type CounterAction = "cash" | "transfer";

/** Posts the leg that RECEIVES money into `destination` — the counterpart
    to `debitDestination` below. Never carries `counters_id`: only the leg
    on the original entry's own account is tracked against it. */
async function creditDestination(
  conn: PoolConnection,
  destination: CounterDestination,
  amount: number,
  transferGroup: string,
  userId: string,
  note: string | null
): Promise<void> {
  if (destination.type === "account") {
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
      [randomUUID(), amount, destination.account, transferGroup, userId, note]
    );
  } else if (destination.type === "wallet") {
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
      [randomUUID(), amount, destination.walletId, transferGroup, userId, note]
    );
  } else {
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, fund, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
      [randomUUID(), amount, destination.fund, transferGroup, userId, note]
    );
  }
}

/** Checks `destination`'s own balance, then posts the leg that LEAVES it —
    used when `destination` is actually the SOURCE (countering a Cash Out
    pulls money in FROM somewhere). Never carries `counters_id` either, same
    reasoning as creditDestination above. */
async function debitDestination(
  conn: PoolConnection,
  destination: CounterDestination,
  amount: number,
  transferGroup: string,
  userId: string,
  note: string | null
): Promise<void> {
  if (destination.type === "account") {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM vault_balance WHERE account = ?",
      [destination.account]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (amount > balance) {
      throw new Error(
        `${MONEY_ACCOUNT_LABELS[destination.account]} only has ${balance.toFixed(2)} available`
      );
    }
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
      [randomUUID(), -amount, destination.account, transferGroup, userId, note]
    );
  } else if (destination.type === "wallet") {
    const rows = await queryConn<{ balance: number; name: string }>(
      conn,
      "SELECT balance, name FROM wallet_balance WHERE wallet_id = ?",
      [destination.walletId]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (amount > balance) {
      throw new Error(
        `${rows[0]?.name ?? "That wallet"} only has ${balance.toFixed(2)} available`
      );
    }
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
      [randomUUID(), -amount, destination.walletId, transferGroup, userId, note]
    );
  } else {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM vault_fund_balance WHERE fund = ?",
      [destination.fund]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (amount > balance) {
      throw new Error(
        `${PROFIT_FUND_LABELS[destination.fund]} only has ${balance.toFixed(2)} available`
      );
    }
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, account, fund, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
      [randomUUID(), -amount, destination.fund, transferGroup, userId, note]
    );
  }
}

/**
 * Posts a counter-action against an existing Cash In/Cash Out — the "IOU"
 * mechanic (see vault_entries.counters_id's own comment in
 * mariadb/schema.sql). Countering a Cash In (money the account gained)
 * moves money back OUT of that same account; countering a Cash Out (money
 * the account lost) moves money back IN. `action: 'cash'` does this as a
 * single plain entry (a real Cash Out/Cash In); `action: 'transfer'` does
 * it as a two-leg transfer to/from a chosen `destination` (another
 * account, a wallet, or a fund) instead — only the leg on the ORIGINAL
 * entry's own account carries `counters_id`, the other leg is an ordinary,
 * untracked transfer leg.
 *
 * `amount` is capped at what's actually remaining on the original entry —
 * read fresh inside this same transaction (via `FOR UPDATE` on the
 * original row) so two concurrent counter-actions against the same entry
 * can't both over-counter it.
 */
export async function counterVaultEntry(
  params: {
    originalId: string;
    action: CounterAction;
    amount: number;
    note?: string | null;
    /** Required when action is 'transfer'; ignored for 'cash'. */
    destination?: CounterDestination;
  },
  userId: string
): Promise<{ remaining: number }> {
  const amount = roundMoney(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter an amount above zero.");
  }
  const note = params.note?.trim() || null;

  return withTransaction(async (conn) => {
    const originalRows = await queryConn<{
      id: string;
      account: MoneyAccount;
      entry_type: "deposit" | "withdrawal";
      amount: number;
    }>(
      conn,
      `SELECT id, account, entry_type, amount FROM vault_entries
       WHERE id = ? AND entry_type IN ('deposit', 'withdrawal')
         AND fund IS NULL AND wallet_id IS NULL
       FOR UPDATE`,
      [params.originalId]
    );
    const original = originalRows[0];
    if (!original) throw new Error("That entry can't be countered.");

    const counteredRows = await queryConn<{ total: number }>(
      conn,
      "SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM vault_entries WHERE counters_id = ?",
      [original.id]
    );
    const remaining = roundMoney(
      Math.abs(Number(original.amount)) -
        roundMoney(Number(counteredRows[0]?.total ?? 0))
    );
    if (amount > remaining) {
      throw new Error(`Only ${remaining.toFixed(2)} remaining on this entry.`);
    }

    const account = original.account;
    // Countering a Cash In (money the account gained) moves money OUT;
    // countering a Cash Out (money the account lost) moves money IN.
    const isReversal = original.entry_type === "deposit";

    if (params.action === "cash") {
      const entryType = isReversal ? "withdrawal" : "deposit";
      if (entryType === "withdrawal" && !note) {
        throw new Error("Say what the money was taken for.");
      }
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, counters_id, created_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          randomUUID(),
          entryType,
          isReversal ? -amount : amount,
          account,
          original.id,
          userId,
          note,
        ]
      );
    } else {
      const destination = params.destination;
      if (!destination) throw new Error("Pick where the money goes.");
      const transferGroup = randomUUID();

      if (isReversal) {
        // Leaves `account` (the tracked leg), arrives at destination.
        await conn.query(
          "INSERT INTO vault_entries (id, entry_type, amount, account, counters_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
          [randomUUID(), -amount, account, original.id, transferGroup, userId, note]
        );
        await creditDestination(conn, destination, amount, transferGroup, userId, note);
      } else {
        // Leaves destination, arrives at `account` (the tracked leg).
        await debitDestination(conn, destination, amount, transferGroup, userId, note);
        await conn.query(
          "INSERT INTO vault_entries (id, entry_type, amount, account, counters_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
          [randomUUID(), amount, account, original.id, transferGroup, userId, note]
        );
      }
    }

    return { remaining: roundMoney(remaining - amount) };
  });
}
