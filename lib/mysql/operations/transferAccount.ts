import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

/**
 * Moves money from one or more OTHER physical accounts into a fixed
 * destination account — e.g. topping up GCash a bit from Cash and Maya at
 * once. The first-ever account-to-account transfer (every other transfer
 * function here moves money between an account and a fund/wallet, never
 * two accounts). Both legs are plain account-tagged 'transfer' entries
 * (fund and wallet_id both NULL on each), so vault_balance's own SUM picks
 * them up exactly like a deposit/withdrawal would — no new balance-view
 * logic needed, unlike fund/wallet transfers which rely on the fund/
 * wallet_id dimension to stay excluded from it. Both legs of one split
 * still share a fresh `transfer_group` id for consistency with every other
 * transfer function, even though it isn't load-bearing here — an
 * account-to-account transfer's own legs are already unambiguous by
 * `account` alone (see vault_entries.transfer_group's own comment, written
 * for the wallet case where that's not true).
 */
export async function transferAccountsToAccount(
  params: {
    toAccount: MoneyAccount;
    splits: { fromAccount: MoneyAccount; amount: number }[];
    note?: string | null;
  },
  userId: string
): Promise<{ toAccount: MoneyAccount; transferred: number }> {
  const { toAccount } = params;
  const note = params.note?.trim() || null;

  // Collapse duplicate sources — same "collapse, don't error" convention
  // every other transfer function here already follows.
  const collapsed = new Map<MoneyAccount, number>();
  for (const split of params.splits) {
    if (split.fromAccount === toAccount) {
      throw new Error("An account can't transfer into itself");
    }
    const amount = roundMoney(split.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Each split amount must be more than 0");
    }
    collapsed.set(
      split.fromAccount,
      roundMoney((collapsed.get(split.fromAccount) ?? 0) + amount)
    );
  }
  if (collapsed.size === 0) {
    return { toAccount, transferred: 0 };
  }
  const transferred = roundMoney(
    [...collapsed.values()].reduce((sum, amount) => sum + amount, 0)
  );

  return withTransaction(async (conn) => {
    // Each source account's own balance is checked independently inside
    // this same transaction — pulling too much from one account doesn't
    // get silently covered by having enough in another (same reasoning
    // transferFundsToAccount/transferWalletsToAccount already follow).
    for (const [fromAccount, amount] of collapsed) {
      const rows = await queryConn<{ balance: number }>(
        conn,
        "SELECT balance FROM vault_balance WHERE account = ?",
        [fromAccount]
      );
      const balance = roundMoney(rows[0]?.balance ?? 0);
      if (amount > balance) {
        throw new Error(
          `${MONEY_ACCOUNT_LABELS[fromAccount]} only has ${balance.toFixed(2)} available`
        );
      }

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

    return { toAccount, transferred };
  });
}
