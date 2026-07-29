import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Node-only (node:crypto's scrypt) — kept out of lib/auth/session.ts so that
// file can stay Edge-safe. Only ever imported from the login Server Action
// and scripts/seed-user.ts, both of which run in the Node runtime.

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/** `scrypt$N=..,r=..,p=..$<saltBase64>$<hashBase64>` — self-describing so a
    future change to the cost parameters doesn't break already-stored
    hashes; verifyPassword reads the parameters back out of the string
    instead of assuming today's constants. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const params = new Map(
    parts[1].split(",").map((pair) => {
      const [key, value] = pair.split("=");
      return [key, Number(value)] as const;
    })
  );
  const n = params.get("N");
  const r = params.get("r");
  const p = params.get("p");
  if (!n || !r || !p) return false;

  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");

  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
