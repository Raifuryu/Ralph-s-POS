import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { PROFIT_FUND_LABELS, type MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

export type ProfitFund = "profit" | "reinvest";

/**
 * Moves money out of a Vault fund (Profit or For Restock) into one or more
 * physical accounts — the only way money in a fund ever becomes real,
 * spendable Cash/GCash/Maya balance (see vault_balance/vault_fund_balance's
 * own comments in mariadb/schema.sql: a fund entry never counts toward a
 * physical account's balance on its own).
 *
 * Posts two rows per split — the fund-leaving leg (negative, fund set,
 * entry_type='transfer') and the account-arriving leg (positive, fund NULL)
 * — rather than one signed row, so summing by fund and summing by account
 * both stay a plain, uniform SUM(amount) with no per-row sign flipping
 * depending on which view is asking. Splitting across several accounts in
 * one call lets the owner cover a payment partly from what a fund already
 * has and partly from elsewhere (e.g. topping off from cashbox once
 * Reinvest alone falls short) in a single, atomic transfer. Both legs of
 * one split share a fresh `transfer_group` id — see vault_entries' own
 * comment on why that exists (it's the wallet-transfer functions that
 * actually need it to disambiguate, not this one, but every transfer
 * function sets it for consistency).
 *
 * No row to lock (a fund balance is a SUM, not a row) — same accepted
 * soft-race as adjustVaultBalance/recordVaultCount already live with for
 * vault_balance: the balance is read and validated inside this same
 * transaction, so two truly concurrent transfers could in theory both pass
 * validation against a balance that's since moved, same tradeoff already
 * made elsewhere in this file for a single-cashier app at this scale.
 */
export async function transferFund(
  params: {
    fund: ProfitFund;
    splits: { account: MoneyAccount; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ fund: ProfitFund; transferred: number; remainingBalance: number }> {
  const { fund } = params;
  const note = params.note?.trim() || null;

  // Collapse duplicate accounts (picking the same account twice in the
  // split form) rather than rejecting — same "collapse, don't error"
  // convention checkout()'s own cart-line grouping already follows.
  const collapsed = new Map<MoneyAccount, number>();
  for (const split of params.splits) {
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(split.account, roundMoney((collapsed.get(split.account) ?? 0) + amount));
  }
  if (collapsed.size === 0) {
    throw new Error("Add at least one account to transfer into");
  }
  const transferred = roundMoney(
    [...collapsed.values()].reduce((sum, amount) => sum + amount, 0)
  );

  return withTransaction(async (conn) => {
    const rows = await queryConn<{ balance: number }>(
      conn,
      "SELECT balance FROM vault_fund_balance WHERE fund = ?",
      [fund]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (transferred > balance) {
      throw new Error(
        `That's more than the fund has (${balance.toFixed(2)} available)`
      );
    }

    for (const [account, amount] of collapsed) {
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, fund, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, account, fund, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), amount, account, transferGroup, userId, note]
      );
    }

    return { fund, transferred, remainingBalance: roundMoney(balance - transferred) };
  });
}

/**
 * The mirror of transferFund, started from the ACCOUNT's side instead of
 * the fund's: one physical account is fixed, and the split picks how much
 * to pull from each fund (Profit and/or For Restock) into it — e.g. an
 * owner looking at Cash and deciding to top it up a bit from both funds at
 * once. Posts the exact same two-leg shape per split (fund-leaving,
 * negative, fund set; account-arriving, positive, fund NULL), just with the
 * roles of the loop variable and the fixed side swapped. Each fund's own
 * balance is checked independently inside this same transaction — pulling
 * too much from one fund doesn't get silently covered by having enough in
 * the other.
 */
export async function transferFundsToAccount(
  params: {
    account: MoneyAccount;
    splits: { fund: ProfitFund; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ account: MoneyAccount; transferred: number }> {
  const { account } = params;
  const note = params.note?.trim() || null;

  // Collapse duplicate funds — same "collapse, don't error" convention
  // transferFund's own account-splits already follow.
  const collapsed = new Map<ProfitFund, number>();
  for (const split of params.splits) {
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(split.fund, roundMoney((collapsed.get(split.fund) ?? 0) + amount));
  }
  if (collapsed.size === 0) {
    throw new Error("Add at least one fund to transfer from");
  }
  const transferred = roundMoney(
    [...collapsed.values()].reduce((sum, amount) => sum + amount, 0)
  );

  return withTransaction(async (conn) => {
    for (const [fund, amount] of collapsed) {
      const rows = await queryConn<{ balance: number }>(
        conn,
        "SELECT balance FROM vault_fund_balance WHERE fund = ?",
        [fund]
      );
      const balance = roundMoney(rows[0]?.balance ?? 0);
      if (amount > balance) {
        throw new Error(
          `${PROFIT_FUND_LABELS[fund]} only has ${balance.toFixed(2)} available`
        );
      }

      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, fund, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, account, fund, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), amount, account, transferGroup, userId, note]
      );
    }

    return { account, transferred };
  });
}
