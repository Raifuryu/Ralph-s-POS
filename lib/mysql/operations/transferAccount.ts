import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount, type ProfitFund } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Moves money out of one physical account into one or more OTHER accounts —
 * e.g. opening Cash box and sending some of it to GCash and Maya at once.
 * The only account-to-account transfer direction this app offers — push
 * only, one source split across several destinations, no "pull into this
 * account from several sources" counterpart (that's not how the owner
 * actually uses this: open the account you're taking money FROM). Both legs
 * are plain account-tagged 'transfer' entries (fund and wallet_id both NULL
 * on each), so vault_balance's own SUM picks them up exactly like a
 * deposit/withdrawal would — no new balance-view logic needed, unlike fund/
 * wallet transfers which rely on the fund/wallet_id dimension to stay
 * excluded from it. Both legs of one split still share a fresh
 * `transfer_group` id for consistency with every other transfer function,
 * even though it isn't load-bearing here — an account-to-account transfer's
 * own legs are already unambiguous by `account` alone (see
 * vault_entries.transfer_group's own comment, written for the wallet case
 * where that's not true).
 */
export async function transferAccountToAccounts(
  params: {
    fromAccount: MoneyAccount;
    splits: { toAccount: MoneyAccount; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{
  fromAccount: MoneyAccount;
  transferred: number;
  remainingBalance: number;
}> {
  const { fromAccount } = params;
  const note = params.note?.trim() || null;

  const collapsed = new Map<MoneyAccount, number>();
  for (const split of params.splits) {
    if (split.toAccount === fromAccount) {
      throw new Error("An account can't transfer into itself");
    }
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(
      split.toAccount,
      roundMoney((collapsed.get(split.toAccount) ?? 0) + amount)
    );
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
      "SELECT balance FROM vault_balance WHERE account = ?",
      [fromAccount]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (transferred > balance) {
      throw new Error(
        `${MONEY_ACCOUNT_LABELS[fromAccount]} only has ${balance.toFixed(2)} available`
      );
    }

    for (const [toAccount, amount] of collapsed) {
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, fromAccount, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), amount, toAccount, transferGroup, userId, note]
      );
    }

    return {
      fromAccount,
      transferred,
      remainingBalance: roundMoney(balance - transferred),
    };
  });
}

/**
 * Moves money out of one physical account into one or both of Profit/For
 * Restock — the first-ever "account → fund" capability (transferWalletToFunds'
 * own doc comment notes this didn't exist yet even for wallets' own sibling
 * feature). The fund-arriving leg is tagged with `account = fromAccount` —
 * not the 'cash' placeholder transferWalletToFunds uses for wallets — so it
 * reads exactly like a sale/service fund credit (see checkout.ts's own
 * fund-crediting inserts) and folds correctly into FundCard's own
 * "breakdown" query (where this fund's money originally came from).
 */
export async function transferAccountToFunds(
  params: {
    fromAccount: MoneyAccount;
    splits: { fund: ProfitFund; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{
  fromAccount: MoneyAccount;
  transferred: number;
  remainingBalance: number;
}> {
  const { fromAccount } = params;
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
      "SELECT balance FROM vault_balance WHERE account = ?",
      [fromAccount]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (transferred > balance) {
      throw new Error(
        `${MONEY_ACCOUNT_LABELS[fromAccount]} only has ${balance.toFixed(2)} available`
      );
    }

    for (const [fund, amount] of collapsed) {
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, fromAccount, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, fund, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)",
        [randomUUID(), amount, fromAccount, fund, transferGroup, userId, note]
      );
    }

    return {
      fromAccount,
      transferred,
      remainingBalance: roundMoney(balance - transferred),
    };
  });
}

/**
 * Moves money out of one physical account into one or more wallets — one
 * source split across several destination wallets. The wallet-arriving leg
 * uses the 'cash' placeholder on its `account` column — a wallet has no
 * "breakdown by account" feature the way a fund does (see
 * transferAccountToFunds' own comment).
 */
export async function transferAccountToWallets(
  params: {
    fromAccount: MoneyAccount;
    splits: { walletId: string; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{
  fromAccount: MoneyAccount;
  transferred: number;
  remainingBalance: number;
}> {
  const { fromAccount } = params;
  const note = params.note?.trim() || null;

  const collapsed = new Map<string, number>();
  for (const split of params.splits) {
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(
      split.walletId,
      roundMoney((collapsed.get(split.walletId) ?? 0) + amount)
    );
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
      "SELECT balance FROM vault_balance WHERE account = ?",
      [fromAccount]
    );
    const balance = roundMoney(rows[0]?.balance ?? 0);
    if (transferred > balance) {
      throw new Error(
        `${MONEY_ACCOUNT_LABELS[fromAccount]} only has ${balance.toFixed(2)} available`
      );
    }

    for (const [walletId, amount] of collapsed) {
      const transferGroup = randomUUID();
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, transfer_group, created_by, note) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [randomUUID(), -amount, fromAccount, transferGroup, userId, note]
      );
      await conn.query(
        "INSERT INTO vault_entries (id, entry_type, amount, account, wallet_id, transfer_group, created_by, note) VALUES (?, 'transfer', ?, 'cash', ?, ?, ?, ?)",
        [randomUUID(), amount, walletId, transferGroup, userId, note]
      );
    }

    return {
      fromAccount,
      transferred,
      remainingBalance: roundMoney(balance - transferred),
    };
  });
}
