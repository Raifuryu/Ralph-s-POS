/**
 * Creates a local login, or resets the password of an existing one.
 *
 *   pnpm seed-user <username> <password>
 *
 * There's no signup UI in this app (accounts were provisioned externally
 * under Supabase too) — this is the only way to get a working login.
 */
import { randomUUID } from "node:crypto";
import { ResultSetHeader } from "mysql2";

import { hashPassword } from "../lib/auth/password";
import { pool } from "../lib/mysql/pool";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: pnpm seed-user <username> <password>");
    process.exitCode = 1;
    return;
  }

  const passwordHash = hashPassword(password);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (id, username, password_hash)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [randomUUID(), username, passwordHash]
  );

  if (result.affectedRows === 2) {
    // MySQL/MariaDB's ON DUPLICATE KEY UPDATE reports 2 affected rows for
    // an update (1 for the failed insert + 1 for the update), 1 for a
    // fresh insert.
    console.log(`Password updated for existing user "${username}".`);
  } else {
    console.log(`Created user "${username}".`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
