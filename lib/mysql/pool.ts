import mysql, { type RowDataPacket } from "mysql2/promise";

// A singleton pool, not a per-request client — pools are expensive to create
// and mysql2 is built to have one long-lived pool per process. Stashed on
// globalThis so Next's dev-mode module reloading (HMR) reuses the same pool
// instead of leaking a new one on every edit.
declare global {
  var __ralphPosPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.MARIADB_HOST,
    port: Number(process.env.MARIADB_PORT ?? 3306),
    user: process.env.MARIADB_USER,
    password: process.env.MARIADB_PASSWORD,
    database: process.env.MARIADB_DATABASE,
    // DECIMAL columns come back as JS numbers instead of strings, matching
    // how the app already does Number(x) everywhere on Supabase's
    // string-typed numerics — avoids touching every call site.
    decimalNumbers: true,
    dateStrings: false,
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
