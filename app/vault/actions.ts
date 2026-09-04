"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireCurrentUser } from "@/lib/auth/session";
import { parseMoney } from "@/lib/money";
import { pool } from "@/lib/mysql/pool";
import {
  labelPersonalTake,
  settlePersonalTake,
} from "@/lib/mysql/operations/settlePersonalTake";
import { recordVaultCount } from "@/lib/mysql/operations/recordVaultCount";
import { adjustVaultBalance } from "@/lib/mysql/operations/adjustVaultBalance";
import { adjustFundBalance } from "@/lib/mysql/operations/adjustFundBalance";
import { adjustWalletBalance } from "@/lib/mysql/operations/adjustWalletBalance";
import {
  recordVaultSnapshot,
  type VaultSnapshotResult,
  type VaultSnapshotTargetDay,
} from "@/lib/mysql/operations/recordVaultSnapshot";
import { transferAccountsToAccount } from "@/lib/mysql/operations/transferAccount";
import {
  counterVaultEntry,
  type CounterDestination,
} from "@/lib/mysql/operations/counterVaultEntry";
import {
  transferFund as transferFundOperation,
  transferFundsToAccount,
} from "@/lib/mysql/operations/transferFund";
import {
  transferAccountsToWallet,
  transferWalletToAccounts,
  transferWalletsToAccount,
  transferWalletToFunds,
  transferWalletToWallets,
} from "@/lib/mysql/operations/transferWallet";
import {
  createWallet as createWalletOperation,
  renameWallet as renameWalletOperation,
  setWalletActive,
} from "@/lib/mysql/operations/wallets";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import type { VaultLedgerFilters } from "@/lib/vault/ledgerFilters";
import {
  isMoneyAccount,
  isProfitFund,
  MONEY_ACCOUNTS,
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUNDS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
  type Wallet,
} from "@/lib/types";
import type { LedgerEntry } from "./ledger";

export type VaultMoveState = { error: string | null; ok?: boolean };

export type VaultCountState = {
  error: string | null;
  result?: {
    account: MoneyAccount;
    counted: number;
    expected: number;
    over_short: number;
  };
};

function parseAccount(raw: FormDataEntryValue | null): MoneyAccount | null {
  const value = String(raw ?? "");
  return isMoneyAccount(value) ? value : null;
}

function parseFund(raw: FormDataEntryValue | null): ProfitFund | null {
  const value = String(raw ?? "");
  return isProfitFund(value) ? value : null;
}

/** A wallet's id is an open-ended UUID (see wallets' own comment), so
    there's no fixed-union check like isMoneyAccount/isProfitFund — just "is
    this non-blank at all," same trust level the FK on
    vault_entries.wallet_id enforces server-side either way. */
function parseWalletId(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

/** Money leaving the box. The note is required — the DB enforces it too. */
export async function cashOut(
  _prev: VaultMoveState,
  formData: FormData
): Promise<VaultMoveState> {
  const account = parseAccount(formData.get("account"));
  if (!account) return { error: "Pick which account the money leaves." };

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say what the money was taken for." };

  const user = await requireCurrentUser();
  await pool.query(
    "INSERT INTO vault_entries (id, entry_type, account, amount, note, created_by) VALUES (?, 'withdrawal', ?, ?, ?, ?)",
    [randomUUID(), account, -amount, note, user.id]
  );

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/** Money added to the box outside of sales (e.g. opening float, change fund). */
export async function cashIn(
  _prev: VaultMoveState,
  formData: FormData
): Promise<VaultMoveState> {
  const account = parseAccount(formData.get("account"));
  if (!account) return { error: "Pick which account the money goes into." };

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  const user = await requireCurrentUser();
  await pool.query(
    "INSERT INTO vault_entries (id, entry_type, account, amount, note, created_by) VALUES (?, 'deposit', ?, ?, ?, ?)",
    [randomUUID(), account, amount, note, user.id]
  );

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/** Money leaving a fund directly, without transferring it into an account
    first — e.g. paying a supplier straight from For Restock. Same shape as
    cashOut, just tagged with `fund` instead of a real account (`account`
    is required but doesn't matter here — see adjustFundBalance's own
    comment on the placeholder). No balance check, matching cashOut's own
    "the owner knows what they're doing" trust level for a manual entry. */
export async function cashOutFund(
  _prev: VaultMoveState,
  formData: FormData
): Promise<VaultMoveState> {
  const fund = parseFund(formData.get("fund"));
  if (!fund) return { error: "Pick which fund the money leaves." };

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say what the money was taken for." };

  const user = await requireCurrentUser();
  await pool.query(
    "INSERT INTO vault_entries (id, entry_type, account, fund, amount, note, created_by) VALUES (?, 'withdrawal', 'cash', ?, ?, ?, ?)",
    [randomUUID(), fund, -amount, note, user.id]
  );

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/** Money added to a fund directly, outside of a sale/service fee — e.g.
    correcting or seeding a fund's balance. Same shape as cashIn, just
    tagged with `fund` instead of a real account. */
export async function cashInFund(
  _prev: VaultMoveState,
  formData: FormData
): Promise<VaultMoveState> {
  const fund = parseFund(formData.get("fund"));
  if (!fund) return { error: "Pick which fund the money goes into." };

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  const user = await requireCurrentUser();
  await pool.query(
    "INSERT INTO vault_entries (id, entry_type, account, fund, amount, note, created_by) VALUES (?, 'deposit', 'cash', ?, ?, ?, ?)",
    [randomUUID(), fund, amount, note, user.id]
  );

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/** Money leaving a wallet directly — the mirror of cashOutFund, tagged with
    `wallet_id` instead of `fund`. */
export async function cashOutWallet(
  _prev: VaultMoveState,
  formData: FormData
): Promise<VaultMoveState> {
  const walletId = parseWalletId(formData.get("wallet_id"));
  if (!walletId) return { error: "Pick which wallet the money leaves." };

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say what the money was taken for." };

  const user = await requireCurrentUser();
  await pool.query(
    "INSERT INTO vault_entries (id, entry_type, account, wallet_id, amount, note, created_by) VALUES (?, 'withdrawal', 'cash', ?, ?, ?, ?)",
    [randomUUID(), walletId, -amount, note, user.id]
  );

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/** Money added to a wallet directly — the mirror of cashInFund, tagged with
    `wallet_id` instead of `fund`. */
export async function cashInWallet(
  _prev: VaultMoveState,
  formData: FormData
): Promise<VaultMoveState> {
  const walletId = parseWalletId(formData.get("wallet_id"));
  if (!walletId) return { error: "Pick which wallet the money goes into." };

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  const user = await requireCurrentUser();
  await pool.query(
    "INSERT INTO vault_entries (id, entry_type, account, wallet_id, amount, note, created_by) VALUES (?, 'deposit', 'cash', ?, ?, ?, ?)",
    [randomUUID(), walletId, amount, note, user.id]
  );

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/**
 * Daily physical count. The expected balance is captured server-side inside
 * recordVaultCount, so it can't go stale between page-load and submit.
 */
export async function recordCount(
  _prev: VaultCountState,
  formData: FormData
): Promise<VaultCountState> {
  const counted = parseMoney(formData.get("counted"));
  if (counted === "bad" || counted === null) {
    return { error: "Enter the counted amount (0 or more, up to centavos)." };
  }

  const account = parseAccount(formData.get("account"));
  if (!account) return { error: "Pick which account you counted." };

  try {
    const user = await requireCurrentUser();
    const result = await recordVaultCount({ account, counted }, user.id);

    revalidatePath("/vault");
    revalidatePath("/");
    return {
      error: null,
      result: {
        account: result.account,
        counted: result.counted,
        expected: result.expected,
        over_short: result.overShort,
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type VaultAdjustState = {
  error: string | null;
  result?: {
    account: MoneyAccount;
    previousBalance: number;
    targetBalance: number;
    delta: number;
  };
};

/** Corrects one account's balance to whatever it's supposed to actually be —
    the cashier types the correct figure, not the difference, and the delta
    that gets logged as an 'adjustment' entry is computed server-side from
    the account's own current balance (see adjustVaultBalance). */
export async function adjustBalance(
  _prev: VaultAdjustState,
  formData: FormData
): Promise<VaultAdjustState> {
  const account = parseAccount(formData.get("account"));
  if (!account) return { error: "Pick which account to adjust." };

  const targetBalance = parseMoney(formData.get("target_balance"));
  if (targetBalance === "bad" || targetBalance === null) {
    return { error: "Enter the correct balance (0 or more, up to centavos)." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  try {
    const user = await requireCurrentUser();
    const result = await adjustVaultBalance(
      { account, targetBalance, note },
      user.id
    );
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type FundAdjustState = {
  error: string | null;
  result?: {
    fund: ProfitFund;
    previousBalance: number;
    targetBalance: number;
    delta: number;
  };
};

/** Corrects one fund's balance to whatever it's supposed to actually be —
    the mirror of adjustBalance, targeting adjustFundBalance instead. */
export async function adjustFund(
  _prev: FundAdjustState,
  formData: FormData
): Promise<FundAdjustState> {
  const fund = parseFund(formData.get("fund"));
  if (!fund) return { error: "Pick which fund to adjust." };

  const targetBalance = parseMoney(formData.get("target_balance"));
  if (targetBalance === "bad" || targetBalance === null) {
    return { error: "Enter the correct balance (0 or more, up to centavos)." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  try {
    const user = await requireCurrentUser();
    const result = await adjustFundBalance({ fund, targetBalance, note }, user.id);
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type WalletAdjustState = {
  error: string | null;
  result?: {
    walletId: string;
    previousBalance: number;
    targetBalance: number;
    delta: number;
  };
};

/** Corrects one wallet's balance to whatever it's supposed to actually be —
    the mirror of adjustFund, targeting adjustWalletBalance instead. */
export async function adjustWallet(
  _prev: WalletAdjustState,
  formData: FormData
): Promise<WalletAdjustState> {
  const walletId = parseWalletId(formData.get("wallet_id"));
  if (!walletId) return { error: "Pick which wallet to adjust." };

  const targetBalance = parseMoney(formData.get("target_balance"));
  if (targetBalance === "bad" || targetBalance === null) {
    return { error: "Enter the correct balance (0 or more, up to centavos)." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  try {
    const user = await requireCurrentUser();
    const result = await adjustWalletBalance({ walletId, targetBalance, note }, user.id);
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type VaultSnapshotState = {
  error: string | null;
  result?: VaultSnapshotResult;
};

/** Whole-vault snapshot — one tap, no typing: the 3 account balances are
    read straight off vault_balance (see recordVaultSnapshot), the same
    figures the account cards themselves already show, plus that day's
    profit/income so far. `target_day` picks which store-day the row is
    filed under ("today" or "yesterday" — see VaultSnapshotSheet's own
    warning copy on why "yesterday" only makes sense right after midnight,
    before anything's happened yet today). Saved as one row per store-day —
    a second tap for the same target day just overwrites the first. */
export async function recordSnapshot(
  _prev: VaultSnapshotState,
  formData: FormData
): Promise<VaultSnapshotState> {
  const targetDay: VaultSnapshotTargetDay =
    formData.get("target_day") === "yesterday" ? "yesterday" : "today";

  try {
    const user = await requireCurrentUser();
    const result = await recordVaultSnapshot(targetDay, user.id);
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type TransferFundState = {
  error: string | null;
  result?: { fund: ProfitFund; transferred: number; remainingBalance: number };
};

/** Moves money out of a fund (Profit/For Restock) into one or more physical
    accounts — see transferFund's own doc comment for why this is the only
    way a fund's balance ever becomes real Cash/GCash/Maya. `split_cash`/
    `split_gcash`/`split_maya` are read straight off the form's per-account
    inputs — see FundCard, which pre-fills them from that fund's own
    "where it came from" breakdown but leaves them fully editable. */
export async function transferFund(
  _prev: TransferFundState,
  formData: FormData
): Promise<TransferFundState> {
  const fundRaw = String(formData.get("fund") ?? "");
  if (!isProfitFund(fundRaw)) {
    return { error: "Pick which fund to transfer from." };
  }

  const splits: { account: MoneyAccount; amount: number }[] = [];
  for (const account of MONEY_ACCOUNTS) {
    const amount = parseMoney(formData.get(`split_${account}`), { allowBlank: true });
    if (amount === "bad") {
      return { error: `Enter a valid amount for ${MONEY_ACCOUNT_LABELS[account]}.` };
    }
    if (amount !== null && amount > 0) {
      splits.push({ account, amount });
    }
  }
  if (splits.length === 0) {
    return { error: "Enter at least one amount to transfer." };
  }

  try {
    const user = await requireCurrentUser();
    const result = await transferFundOperation({ fund: fundRaw, splits }, user.id);
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type TransferWalletState = {
  error: string | null;
  result?: { walletId: string; transferred: number; remainingBalance: number };
};

/** Moves money out of a wallet into one or more physical accounts, Profit/
    For Restock, and/or other wallets — `split_cash`/`split_gcash`/
    `split_maya` are read the same way transferFund's own splits are,
    `split_profit`/`split_reinvest` the same way. Destination wallets ride
    along as a `dest_wallet_splits` JSON field instead — a wallet's id isn't
    a fixed literal, so there's no fixed `split_<id>` field name to loop
    over (same "JSON field for a dynamic list" convention transferToAccount's
    own `wallet_splits` field already uses). Posted as up to three separate
    transfers (accounts, then funds, then wallets) rather than one combined
    operation — safe because they're awaited in sequence, so each later
    transfer's own balance check reads the wallet's balance AFTER the
    earlier one already committed, never double-spending the same pesos
    (same reasoning transferToAccount's own combined fund+wallet calls
    already rely on). */
export async function transferWalletOut(
  _prev: TransferWalletState,
  formData: FormData
): Promise<TransferWalletState> {
  const walletId = parseWalletId(formData.get("wallet_id"));
  if (!walletId) return { error: "Pick which wallet to transfer from." };

  const accountSplits: { account: MoneyAccount; amount: number }[] = [];
  for (const account of MONEY_ACCOUNTS) {
    const amount = parseMoney(formData.get(`split_${account}`), { allowBlank: true });
    if (amount === "bad") {
      return { error: `Enter a valid amount for ${MONEY_ACCOUNT_LABELS[account]}.` };
    }
    if (amount !== null && amount > 0) {
      accountSplits.push({ account, amount });
    }
  }

  const fundSplits: { fund: ProfitFund; amount: number }[] = [];
  for (const fund of PROFIT_FUNDS) {
    const amount = parseMoney(formData.get(`split_${fund}`), { allowBlank: true });
    if (amount === "bad") {
      return { error: `Enter a valid amount for ${PROFIT_FUND_LABELS[fund]}.` };
    }
    if (amount !== null && amount > 0) {
      fundSplits.push({ fund, amount });
    }
  }

  let walletSplits: { walletId: string; amount: number }[] = [];
  const walletSplitsRaw = String(formData.get("dest_wallet_splits") ?? "");
  if (walletSplitsRaw) {
    try {
      const parsed: unknown = JSON.parse(walletSplitsRaw);
      if (!Array.isArray(parsed)) throw new Error("bad shape");
      walletSplits = parsed.map((entry) => {
        const destWalletId = String((entry as { walletId?: unknown }).walletId ?? "");
        const amount = Number((entry as { amount?: unknown }).amount);
        if (!destWalletId || !Number.isFinite(amount) || amount <= 0) {
          throw new Error("bad entry");
        }
        return { walletId: destWalletId, amount };
      });
    } catch {
      return { error: "Something went wrong reading the wallet split." };
    }
  }

  if (accountSplits.length === 0 && fundSplits.length === 0 && walletSplits.length === 0) {
    return { error: "Enter at least one amount to transfer." };
  }

  try {
    const user = await requireCurrentUser();
    let transferred = 0;
    let remainingBalance = 0;
    if (accountSplits.length > 0) {
      const result = await transferWalletToAccounts(
        { walletId, splits: accountSplits },
        user.id
      );
      transferred += result.transferred;
      remainingBalance = result.remainingBalance;
    }
    if (fundSplits.length > 0) {
      const result = await transferWalletToFunds(
        { walletId, splits: fundSplits },
        user.id
      );
      transferred += result.transferred;
      remainingBalance = result.remainingBalance;
    }
    if (walletSplits.length > 0) {
      const result = await transferWalletToWallets(
        { walletId, splits: walletSplits },
        user.id
      );
      transferred += result.transferred;
      remainingBalance = result.remainingBalance;
    }
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result: { walletId, transferred, remainingBalance } };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type TransferIntoWalletState = {
  error: string | null;
  result?: { walletId: string; transferred: number };
};

/** Pulls money into a fixed wallet from one or more accounts — the mirror
    of transferToAccount's own account-splits, started from the wallet's
    side instead of an account's. `split_cash`/`split_gcash`/`split_maya`
    are read the same way transferToAccount's own account-source fields
    already are (see transferAccountsToWallet's own doc comment — this is
    the last account/fund/wallet direction that didn't have a real transfer
    path yet). */
export async function transferIntoWallet(
  _prev: TransferIntoWalletState,
  formData: FormData
): Promise<TransferIntoWalletState> {
  const walletId = parseWalletId(formData.get("wallet_id"));
  if (!walletId) return { error: "Pick which wallet to transfer into." };

  const splits: { fromAccount: MoneyAccount; amount: number }[] = [];
  for (const account of MONEY_ACCOUNTS) {
    const amount = parseMoney(formData.get(`split_${account}`), { allowBlank: true });
    if (amount === "bad") {
      return { error: `Enter a valid amount for ${MONEY_ACCOUNT_LABELS[account]}.` };
    }
    if (amount !== null && amount > 0) {
      splits.push({ fromAccount: account, amount });
    }
  }
  if (splits.length === 0) {
    return { error: "Enter at least one amount to transfer." };
  }

  try {
    const user = await requireCurrentUser();
    const result = await transferAccountsToWallet({ walletId, splits }, user.id);
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type TransferToAccountState = {
  error: string | null;
  result?: { account: MoneyAccount; transferred: number };
};

/** Pulls money into one fixed account from any other account, Profit/For
    Restock, and/or any wallet — the mirror of transferFund, started from
    an account's own sheet instead of a fund's (see transferFundsToAccount's
    own doc comment), now also covering account-to-account via
    transferAccountsToAccount (the only place that capability exists — see
    its own doc comment). `split_cash`/`split_gcash`/`split_maya` (the OTHER
    two accounts) and `split_profit`/`split_reinvest` are read straight off
    the form's own inputs, same convention transferFund's own split_*
    fields already use. Wallet splits ride along as a separate
    `wallet_splits` JSON field instead — a wallet's id isn't a fixed literal
    like an account/fund, so there's no fixed `split_<id>` field name to
    loop over the way MONEY_ACCOUNTS/PROFIT_FUNDS let the loops above do
    (same "JSON field for a dynamic list" convention app/inventory/actions.ts's
    own bulkRestock already uses for its payment split). Posted as up to
    three separate transfers (accounts, then funds, then wallets) rather
    than one combined operation — each already validates its own source's
    balance independently, same as if the owner had submitted them one at a
    time. */
export async function transferToAccount(
  _prev: TransferToAccountState,
  formData: FormData
): Promise<TransferToAccountState> {
  const account = parseAccount(formData.get("account"));
  if (!account) return { error: "Pick which account to transfer into." };

  // The other two accounts — same `split_${x}` literal-field convention
  // the fund loop below already uses, safe from collision since this
  // action never reads `split_cash`/`split_gcash`/`split_maya` for
  // anything else.
  const accountSplits: { fromAccount: MoneyAccount; amount: number }[] = [];
  for (const fromAccount of MONEY_ACCOUNTS) {
    if (fromAccount === account) continue;
    const amount = parseMoney(formData.get(`split_${fromAccount}`), { allowBlank: true });
    if (amount === "bad") {
      return { error: `Enter a valid amount for ${MONEY_ACCOUNT_LABELS[fromAccount]}.` };
    }
    if (amount !== null && amount > 0) {
      accountSplits.push({ fromAccount, amount });
    }
  }

  const fundSplits: { fund: ProfitFund; amount: number }[] = [];
  for (const fund of PROFIT_FUNDS) {
    const amount = parseMoney(formData.get(`split_${fund}`), { allowBlank: true });
    if (amount === "bad") {
      return { error: `Enter a valid amount for ${PROFIT_FUND_LABELS[fund]}.` };
    }
    if (amount !== null && amount > 0) {
      fundSplits.push({ fund, amount });
    }
  }

  let walletSplits: { walletId: string; amount: number }[] = [];
  const walletSplitsRaw = String(formData.get("wallet_splits") ?? "");
  if (walletSplitsRaw) {
    try {
      const parsed: unknown = JSON.parse(walletSplitsRaw);
      if (!Array.isArray(parsed)) throw new Error("bad shape");
      walletSplits = parsed.map((entry) => {
        const walletId = String((entry as { walletId?: unknown }).walletId ?? "");
        const amount = Number((entry as { amount?: unknown }).amount);
        if (!walletId || !Number.isFinite(amount) || amount <= 0) {
          throw new Error("bad entry");
        }
        return { walletId, amount };
      });
    } catch {
      return { error: "Something went wrong reading the wallet split." };
    }
  }

  if (accountSplits.length === 0 && fundSplits.length === 0 && walletSplits.length === 0) {
    return { error: "Enter at least one amount to transfer." };
  }

  try {
    const user = await requireCurrentUser();
    let transferred = 0;
    if (accountSplits.length > 0) {
      const result = await transferAccountsToAccount(
        { toAccount: account, splits: accountSplits },
        user.id
      );
      transferred += result.transferred;
    }
    if (fundSplits.length > 0) {
      const result = await transferFundsToAccount(
        { account, splits: fundSplits },
        user.id
      );
      transferred += result.transferred;
    }
    if (walletSplits.length > 0) {
      const result = await transferWalletsToAccount(
        { account, splits: walletSplits },
        user.id
      );
      transferred += result.transferred;
    }
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result: { account, transferred } };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type CreateWalletState = { error: string | null; result?: Wallet };

/** Adds a new owner-managed wallet — see wallets' own comment in
    mariadb/schema.sql. Just a name; color is auto-assigned server-side
    (createWallet's own walletColorFor). */
export async function createWalletAction(
  _prev: CreateWalletState,
  formData: FormData
): Promise<CreateWalletState> {
  const name = String(formData.get("name") ?? "");

  try {
    const user = await requireCurrentUser();
    const result = await createWalletOperation({ name }, user.id);
    revalidatePath("/vault");
    revalidatePath("/inventory");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type RenameWalletState = { error: string | null; ok?: boolean };

/** Renames a wallet in place — its id (and every past ledger entry) is
    untouched, see renameWallet's own comment. */
export async function renameWalletAction(
  _prev: RenameWalletState,
  formData: FormData
): Promise<RenameWalletState> {
  const walletId = parseWalletId(formData.get("wallet_id"));
  if (!walletId) return { error: "Missing wallet." };
  const name = String(formData.get("name") ?? "");

  try {
    await renameWalletOperation({ id: walletId, name });
    revalidatePath("/vault");
    revalidatePath("/inventory");
    return { error: null, ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Archives/unarchives a wallet — a plain fire-and-forget action (no
    useActionState-driven form on the caller's side, just a button), see
    setWalletActive's own comment on what `is_active` does. */
export async function setWalletActiveAction(
  walletId: string,
  active: boolean
): Promise<void> {
  await setWalletActive({ id: walletId, active });
  revalidatePath("/vault");
  revalidatePath("/inventory");
}

/** Fetches the next batch of ledger rows for VaultLedgerClient's "Load more"
    button — same query the page itself uses for its first batch, just at a
    later offset, so results stay consistent even if the filters came from a
    URL a cashier bookmarked or shared. */
export async function loadMoreVaultEntries(
  filters: VaultLedgerFilters,
  offset: number
): Promise<{ entries: LedgerEntry[]; total: number }> {
  return fetchVaultLedgerPage(filters, offset);
}

export type PersonalTakeActionState = { error: string | null; ok?: boolean };

function debtorFields(formData: FormData): {
  debtorName: string | null;
  debtorDescription: string | null;
} {
  return {
    debtorName: String(formData.get("debtor_name") ?? "").trim() || null,
    debtorDescription:
      String(formData.get("debtor_description") ?? "").trim() || null,
  };
}

/** Saves/updates who a personal take belongs to without settling it — the
    owner might only find out (or remember) the debtor's name a while after
    the take itself. */
export async function labelDebtor(
  _prev: PersonalTakeActionState,
  formData: FormData
): Promise<PersonalTakeActionState> {
  const transactionId = String(formData.get("transaction_id") ?? "");
  if (!transactionId) return { error: "Missing transaction." };

  try {
    await labelPersonalTake({ transactionId, ...debtorFields(formData) });
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Marks a personal take as paid back — posts the amount into whichever
    account the debtor actually paid into, the first time that take's value
    ever reaches the vault (see settlePersonalTake's own comment on why
    nothing was posted at the time it was taken). */
export async function settleDebt(
  _prev: PersonalTakeActionState,
  formData: FormData
): Promise<PersonalTakeActionState> {
  const transactionId = String(formData.get("transaction_id") ?? "");
  if (!transactionId) return { error: "Missing transaction." };

  const account = parseAccount(formData.get("account"));
  if (!account) return { error: "Pick which account received the payment." };

  // Which of the two "Mark as paid" buttons was clicked — see the button
  // pair in personalTakesSheet.tsx, each submitting the same form with a
  // different name="at_selling_price" value baked into the button itself.
  const atSellingPrice = formData.get("at_selling_price") === "1";

  try {
    const user = await requireCurrentUser();
    await settlePersonalTake(
      { transactionId, account, atSellingPrice, ...debtorFields(formData) },
      user.id
    );
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type CounterEntryState = {
  error: string | null;
  result?: { remaining: number };
};

/** Reads the transfer-counter-action's own destination fields — one of
    three shapes depending on `destination_type`, same "one hidden field
    picks which kind" convention nothing else in this file quite needed
    before (every other transfer target here was a single fixed kind). */
function parseCounterDestination(formData: FormData): CounterDestination | null {
  const type = String(formData.get("destination_type") ?? "");
  if (type === "account") {
    const account = parseAccount(formData.get("destination_account"));
    return account ? { type: "account", account } : null;
  }
  if (type === "wallet") {
    const walletId = parseWalletId(formData.get("destination_wallet_id"));
    return walletId ? { type: "wallet", walletId } : null;
  }
  if (type === "fund") {
    const fund = parseFund(formData.get("destination_fund"));
    return fund ? { type: "fund", fund } : null;
  }
  return null;
}

/** Posts a counter-action against a Cash In/Cash Out — the Baseline Fund
    card's own History sheet is the only place this is called from. See
    counterVaultEntry's own doc comment for what "countering" actually
    does. */
export async function counterEntry(
  _prev: CounterEntryState,
  formData: FormData
): Promise<CounterEntryState> {
  const originalId = String(formData.get("original_id") ?? "");
  if (!originalId) return { error: "Missing entry." };

  const actionRaw = String(formData.get("action") ?? "");
  if (actionRaw !== "cash" && actionRaw !== "transfer") {
    return { error: "Pick how to counter this entry." };
  }

  const amount = parseMoney(formData.get("amount"), { requirePositive: true });
  if (amount === "bad" || amount === null) {
    return { error: "Enter an amount above zero." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;

  let destination: CounterDestination | undefined;
  if (actionRaw === "transfer") {
    const parsed = parseCounterDestination(formData);
    if (!parsed) return { error: "Pick where the money goes." };
    destination = parsed;
  }

  try {
    const user = await requireCurrentUser();
    const result = await counterVaultEntry(
      { originalId, action: actionRaw, amount, note, destination },
      user.id
    );
    revalidatePath("/vault");
    revalidatePath("/");
    return { error: null, result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
