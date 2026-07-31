"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireCurrentUser } from "@/lib/auth/session";
import { parseMoney } from "@/lib/money";
import { pool } from "@/lib/mysql/pool";
import { recordVaultCount } from "@/lib/mysql/operations/recordVaultCount";
import { fetchVaultLedgerPage } from "@/lib/vault/ledgerQuery";
import type { VaultLedgerFilters } from "@/lib/vault/ledgerFilters";
import { isMoneyAccount, type MoneyAccount } from "@/lib/types";
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
