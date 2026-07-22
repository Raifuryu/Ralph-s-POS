"use server";

import { revalidatePath } from "next/cache";

import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isMoneyAccount, type MoneyAccount } from "@/lib/types";

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

  const supabase = await createClient();
  const { error } = await supabase.from("vault_entries").insert({
    entry_type: "withdrawal",
    account,
    amount: -amount,
    note,
  });

  if (error) return { error: error.message };

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

  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.from("vault_entries").insert({
    entry_type: "deposit",
    account,
    amount,
    note: note || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, ok: true };
}

/**
 * Daily physical count. The expected balance is captured server-side inside
 * the DB function, so it can't go stale between page-load and submit.
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_vault_count", {
    p_account: account,
    p_counted: counted,
  });

  if (error) return { error: error.message };

  revalidatePath("/vault");
  revalidatePath("/");
  return {
    error: null,
    result: data as {
      account: MoneyAccount;
      counted: number;
      expected: number;
      over_short: number;
    },
  };
}
