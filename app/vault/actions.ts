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
