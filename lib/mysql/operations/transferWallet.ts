import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Moves money out of a wallet into one or more physical accounts — the exact
 * mirror of transferFund, just keyed by `wallet_id` instead of the fixed
 * `fund` enum. Same two-leg posting (wallet-leaving, negative, wallet_id
 * set; account-arriving, positive, wallet_id NULL) and the same reasoning
 * for it — see transferFund's own doc comment.
 */
export async function transferWalletToAccounts(
  params: {
    walletId: string;
    splits: { account: MoneyAccount; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ walletId: string; transferred: number; remainingBalance: number }> {
  const { walletId } = params;
  const note = params.note?.trim() || null;

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
      "SELECT balance FROM wallet_balance WHERE wallet_id = ?",
      [walletId]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (transferred > balance) {
      throw new Error(
        `That's more than the wallet has (${balance.toFixed(2)} available)`
      );
    }

    for (const [account, amount] of collapsed) {
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, account, walletId, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?)",
        [randomUUID(), amount, account, userId, note]
      );
    }

    return { walletId, transferred, remainingBalance: roundMoney(balance - transferred) };
  });
}

/**
 * The mirror of transferWalletToAccounts, started from the ACCOUNT's side
 * instead of a wallet's — one physical account is fixed, and the split picks
 * how much to pull from each wallet into it. Exact mirror of
 * transferFundsToAccount, keyed by `wallet_id` instead of `fund`.
 */
export async function transferWalletsToAccount(
  params: {
    account: MoneyAccount;
    splits: { walletId: string; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ account: MoneyAccount; transferred: number }> {
  const { account } = params;
  const note = params.note?.trim() || null;

  const collapsed = new Map<string, number>();
  for (const split of params.splits) {
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(split.walletId, roundMoney((collapsed.get(split.walletId) ?? 0) + amount));
  }
  if (collapsed.size === 0) {
    return { account, transferred: 0 };
  }
  const transferred = roundMoney(
    [...collapsed.values()].reduce((sum, amount) => sum + amount, 0)
  );

  return withTransaction(async (conn) => {
    for (const [walletId, amount] of collapsed) {
      const rows = await queryConn<{ balance: number; name: string }>(
        conn,
        "SELECT balance, name FROM wallet_balance WHERE wallet_id = ?",
        [walletId]
      );
      const balance = roundMoney(rows[0]?.balance ?? 0);
      if (amount > balance) {
        throw new Error(
          `${rows[0]?.name ?? "That wallet"} only has ${balance.toFixed(2)} available`
        );
      }

      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, account, walletId, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?)",
        [randomUUID(), amount, account, userId, note]
      );
    }

    return { account, transferred };
  });
}
