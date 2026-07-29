/**
 * Thin passthrough for ad hoc SQL against the local MariaDB — there's no
 * `mysql`/`mariadb` CLI assumed to be installed, so this fills that gap for
 * verification during the port (row counts, spot-checking a migrated row,
 * confirming a CHECK constraint actually rejects bad data, etc.).
 *
 *   pnpm db-query "SELECT COUNT(*) FROM products"
 */
import { pool } from "../lib/mysql/pool";

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query.trim()) {
    console.error('Usage: pnpm db-query "SELECT ..."');
    process.exitCode = 1;
    return;
  }

  const [rows] = await pool.query(query);
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
