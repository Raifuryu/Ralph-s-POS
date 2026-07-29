import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/** DECIMAL(12,2)/DECIMAL(10,2) columns round to 2 places on write regardless
    — this just keeps JS-side running totals from drifting on floating-point
    additions before they're stored, mirroring what Postgres numeric(12,2)
    did implicitly. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Runs `sql` on the given transaction connection and returns typed rows —
    same shape as lib/mysql/pool.ts's queryRows, but bound to one connection
    instead of the pool, for use inside a transaction. */
export async function queryConn<T>(
  conn: PoolConnection,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await conn.query<(T & RowDataPacket)[]>(sql, params);
  return rows as T[];
}

/** `?, ?, ?` for however many params — for building a dynamic IN (...) list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
