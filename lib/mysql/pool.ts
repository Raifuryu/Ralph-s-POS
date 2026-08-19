import mysql, { type RowDataPacket } from "mysql2/promise";

// A singleton pool, not a per-request client — pools are expensive to create
// and mysql2 is built to have one long-lived pool per process. Stashed on
// globalThis so Next's dev-mode module reloading (HMR) reuses the same pool
// instead of leaking a new one on every edit.
declare global {
  var __ralphPosPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  const pool = mysql.createPool({
    host: process.env.MARIADB_HOST,
    port: Number(process.env.MARIADB_PORT ?? 3306),
    user: process.env.MARIADB_USER,
    password: process.env.MARIADB_PASSWORD,
    database: process.env.MARIADB_DATABASE,
    // DECIMAL columns come back as JS numbers instead of strings, matching
    // how the app already does Number(x) everywhere on Supabase's
    // string-typed numerics — avoids touching every call site.
    decimalNumbers: true,
    // DATE/DATETIME/TIMESTAMP columns come back as plain "YYYY-MM-DD[ HH:MM:SS]"
    // strings, not inflated into JS Date objects — every Row type in this
    // app (created_at, voided_at, expiry_date, ...) is typed as `string`,
    // matching what Supabase's client always returned. Getting this wrong
    // caused a real production bug: `dateStrings: false` (mysql2's default)
    // silently handed out Date objects instead, and any code calling a
    // string-only method directly on one (e.g. .localeCompare() to sort by
    // created_at) threw a TypeError — see the History sheet crash in
    // app/inventory/page.tsx, which only surfaced for products with 2+
    // combined restock/sale rows (Array.sort never invokes the comparator
    // for 0-1 elements, so quieter products never hit it). Comparisons that
    // didn't call a string method (e.g. `expiry_date < todayKey`) didn't
    // crash but were silently wrong instead, comparing a stringified Date
    // against a "YYYY-MM-DD" key.
    dateStrings: true,
    connectionLimit: 10,
    // mysql2 returns TINYINT(1) — what BOOLEAN actually is in MariaDB — as
    // a raw 0/1 number by default, and JSON columns as a raw string, not a
    // parsed value. The app's types (is_active, is_personal_take, ...) and
    // its JSON-column readers (parseFeeTiers, parseUnitPrices, the
    // allowed_payment_accounts array) assume real booleans/parsed JSON,
    // matching what Supabase's client already gave them — cast both here
    // rather than touching every call site.
    typeCast(field, next) {
      if (field.type === "TINY" && field.length === 1) {
        return field.string() === "1";
      }
      if (field.type === "JSON") {
        const raw = field.string();
        return raw === null ? null : JSON.parse(raw);
      }
      return next();
    },
  });

  // The store is in the Philippines. This pins every connection's SESSION
  // time_zone to Manila regardless of whatever this MariaDB server's own
  // default happens to be — without it, CURRENT_TIMESTAMP defaults and
  // NOW()-based view logic (product_sales_totals' "last 3 days") would
  // compute against the server's default zone instead of the store's
  // actual calendar day. With dateStrings above, this is also what makes
  // the "YYYY-MM-DD HH:MM:SS" strings the app reads back already be Manila
  // wall-clock time — mysql2 just passes through whatever the server
  // formatted the value as, no client-side timezone conversion involved.
  // Any later `new Date(thatString)` call (storeDayKey, formatDateTime,
  // ...) still relies on the Node process's own TZ env var to parse a
  // timezone-less string correctly — see the Dockerfile/package.json
  // scripts, both set to Asia/Manila too, so both ends agree.
  //
  // Every table in mariadb/schema.sql is declared COLLATE=utf8mb4_unicode_ci,
  // but mysql2 doesn't know that — without an explicit collation set here,
  // it negotiates whatever collation the server offers first for utf8mb4
  // (commonly utf8mb4_general_ci), and binds every `?` string parameter
  // with THAT collation. Comparing a parameter against a real column then
  // hits MariaDB's "Illegal mix of collations" error — not on every query,
  // only ones that actually compare a bound parameter against an ENUM/
  // VARCHAR column (e.g. `WHERE account = ?` against vault_entries.account),
  // which is why this stayed hidden until adjustVaultBalance became the
  // first such comparison actually exercised in production. SET NAMES here
  // forces the session's own collation to match the schema's, so
  // parameters and columns always agree.
  pool.on("connection", (connection) => {
    connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    connection.query("SET time_zone = '+08:00'");
  });

  return pool;
}

export const pool: mysql.Pool = globalThis.__ralphPosPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalThis.__ralphPosPool = pool;
}

/**
 * Thin typed wrapper around pool.query for plain SELECTs — every page's
 * Row types (Product, Category, ...) are hand-written interfaces, not
 * RowDataPacket subclasses, so this hides the cast every call site would
 * otherwise need to repeat.
 */
export async function queryRows<T>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await pool.query<(T & RowDataPacket)[]>(sql, params);
  return rows as T[];
}

/**
 * Runs `fn` inside a single transaction on one dedicated connection —
 * BEGIN, then COMMIT on success or ROLLBACK on any thrown error, always
 * releasing the connection back to the pool afterward. Mirrors the
 * transactional guarantee every PL/pgSQL function used to get for free.
 */
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
