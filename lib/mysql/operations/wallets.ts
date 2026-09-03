import { randomUUID } from "node:crypto";

import { pool, queryRows } from "@/lib/mysql/pool";
import { walletColorFor, type Wallet } from "@/lib/types";

/** MariaDB's duplicate-key error code — thrown when `name` collides with
    wallets_name_unique. Narrower than a bare `unknown` catch so a real
    connection/syntax error still surfaces instead of getting misreported as
    "name taken". */
function isDuplicateNameError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "ER_DUP_ENTRY";
}

/** Creates a new owner-managed wallet — see wallets' own comment in
    mariadb/schema.sql. Color is auto-assigned from a small rotating palette
    (walletColorFor) rather than picked in the form; keeps "Add wallet" to
    just a name. */
export async function createWallet(
  params: { name: string },
  cashierId: string
): Promise<Wallet> {
  const name = params.name.trim();
  if (!name) throw new Error("Enter a name for this wallet");
  if (name.length > 50) throw new Error("Keep the name under 50 characters");

  const [{ count }] = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM wallets"
  );
  const color = walletColorFor(count);
  const id = randomUUID();

  try {
    await pool.query(
      "INSERT INTO wallets (id, name, color, created_by) VALUES (?, ?, ?, ?)",
      [id, name, color, cashierId]
    );
  } catch (err) {
    if (isDuplicateNameError(err)) {
      throw new Error("A wallet with that name already exists");
    }
    throw err;
  }

  return {
    id,
    name,
    color,
    is_active: true,
    created_by: cashierId,
    created_at: new Date().toISOString(),
  };
}

/** Renames a wallet in place — its id (and every past ledger entry pointing
    at it) is untouched, so history keeps reading correctly under the new
    name. */
export async function renameWallet(params: { id: string; name: string }): Promise<void> {
  const name = params.name.trim();
  if (!name) throw new Error("Enter a name for this wallet");
  if (name.length > 50) throw new Error("Keep the name under 50 characters");

  try {
    await pool.query("UPDATE wallets SET name = ? WHERE id = ?", [name, params.id]);
  } catch (err) {
    if (isDuplicateNameError(err)) {
      throw new Error("A wallet with that name already exists");
    }
    throw err;
  }
}

/** Archives/unarchives a wallet — see wallets' own comment on what
    `is_active` does (and doesn't) mean. No balance check on archiving: a
    wallet can be archived with money still in it, same "the owner knows
    what they're doing" trust level the rest of this manual-entry system
    already extends. */
export async function setWalletActive(params: {
  id: string;
  active: boolean;
}): Promise<void> {
  await pool.query("UPDATE wallets SET is_active = ? WHERE id = ?", [
    params.active,
    params.id,
  ]);
}
