import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount, ProfitFund } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Moves money out of a wallet into one or more physical accounts — the exact
 * mirror of transferFund, just keyed by `wallet_id` instead of the fixed
 * `fund` enum. Same two-leg posting (wallet-leaving, negative, wallet_id
 * set; account-arriving, positive, wallet_id NULL) and the same reasoning
 * for it — see transferFund's own doc comment. Both legs share a fresh
 * `transfer_group` id, same as every other transfer function here — see
 * vault_entries' own comment on why that matters specifically for a
 * wallet's leaving leg (this function's own arriving leg is the "landed on
 * a real account" case that comment describes).
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
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, account, walletId, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), amount, account, transferGroup, userId, note]
      );
    }

    return { walletId, transferred, remainingBalance: roundMoney(balance - transferred) };
  });
}

/**
 * Moves money out of a wallet into one or both of Profit/For Restock — the
 * first-ever "wallet → fund" capability (there's no "account → fund"
 * transfer either; every other fund-crediting path is a sale/service fee or
 * a fund's own Cash in). Same two-leg posting as transferWalletToAccounts,
 * just with a fund on the arriving leg instead of a real account —
 * `account` is required (NOT NULL) but doesn't matter for balance purposes
 * on EITHER leg here (both are excluded from vault_balance by having
 * `wallet_id`/`fund` set respectively), so 'cash' is used as the same
 * placeholder value every other fund/wallet-only entry already uses.
 */
export async function transferWalletToFunds(
  params: {
    walletId: string;
    splits: { fund: ProfitFund; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ walletId: string; transferred: number; remainingBalance: number }> {
  const { walletId } = params;
  const note = params.note?.trim() || null;

  const collapsed = new Map<ProfitFund, number>();
  for (const split of params.splits) {
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(split.fund, roundMoney((collapsed.get(split.fund) ?? 0) + amount));
  }
  if (collapsed.size === 0) {
    throw new Error("Add at least one fund to transfer into");
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

    for (const [fund, amount] of collapsed) {
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
        [randomUUID(), -amount, walletId, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, fund, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
        [randomUUID(), amount, fund, transferGroup, userId, note]
      );
    }

    return { walletId, transferred, remainingBalance: roundMoney(balance - transferred) };
  });
}

/**
 * Moves money out of one wallet into one or more OTHER wallets — unlike
 * transferWalletToAccounts/transferWalletToFunds, both legs here carry a
 * `wallet_id` (the source's leaving leg and the destination's arriving leg,
 * pointed at two different wallets) rather than one leg landing on a real
 * account/fund; `wallet_balance`'s plain `SUM(amount) WHERE wallet_id = ?`
 * still works correctly since each wallet only ever sees its own leg.
 * `account` is still required (NOT NULL) but still doesn't matter for
 * balance purposes on either leg — same 'cash' placeholder as every other
 * fund/wallet-only entry.
 */
export async function transferWalletToWallets(
  params: {
    walletId: string;
    splits: { walletId: string; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ walletId: string; transferred: number; remainingBalance: number }> {
  const { walletId } = params;
  const note = params.note?.trim() || null;

  const collapsed = new Map<string, number>();
  for (const split of params.splits) {
    if (split.walletId === walletId) {
      throw new Error("A wallet can't transfer into itself");
    }
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(split.walletId, roundMoney((collapsed.get(split.walletId) ?? 0) + amount));
  }
  if (collapsed.size === 0) {
    throw new Error("Add at least one wallet to transfer into");
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

    for (const [destWalletId, amount] of collapsed) {
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
        [randomUUID(), -amount, walletId, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
        [randomUUID(), amount, destWalletId, transferGroup, userId, note]
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

      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, account, walletId, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), amount, account, transferGroup, userId, note]
      );
    }

    return { account, transferred };
  });
}
