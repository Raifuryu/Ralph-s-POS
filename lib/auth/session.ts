import { cookies } from "next/headers";

// Pure Web Crypto (crypto.subtle, btoa/atob, TextEncoder) throughout this
// file — no Node-only APIs — so the exact same verify function runs
// unmodified in proxy.ts (Edge runtime) and in Server Actions/Components
// (Node runtime). Password hashing needs Node's `node:crypto` scrypt and
// lives in ./password.ts instead, kept out of this file specifically so
// importing it never drags a Node-only module into the Edge bundle.

const SESSION_COOKIE_NAME = "ralph_pos_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

type SessionPayload = {
  uid: string;
  username: string;
  iat: number;
  exp: number;
};

export type CurrentUser = { id: string; username: string };

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return new Uint8Array(signature);
}

// Not Node's crypto.timingSafeEqual (Node-only, and requires equal-length
// buffers already known ahead of time) — this small hand-rolled version
// works identically in Edge and Node. The lengths of two HMAC-SHA256
// signatures are always equal and public knowledge anyway, so comparing
// length first leaks nothing a real attacker didn't already know.
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionCookieValue(
  user: CurrentUser
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: user.id,
    username: user.username,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const payloadB64 = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signatureB64 = bytesToBase64Url(
    await hmacSha256(getSessionSecret(), payloadB64)
  );
  return `${payloadB64}.${signatureB64}`;
}

export async function verifySessionCookieValue(
  value: string | undefined | null
): Promise<CurrentUser | null> {
  if (!value) return null;
  const [payloadB64, signatureB64] = value.split(".");
  if (!payloadB64 || !signatureB64) return null;

  try {
    const expectedB64 = bytesToBase64Url(
      await hmacSha256(getSessionSecret(), payloadB64)
    );
    if (!timingSafeEqualString(expectedB64, signatureB64)) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64))
    ) as Partial<SessionPayload>;
    if (
      typeof payload.uid !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { id: payload.uid, username: payload.username };
  } catch {
    // Corrupt/tampered cookie — treat exactly like "not signed in".
    return null;
  }
}

/** Sets the session cookie — call from a Server Action after verifying
    credentials (e.g. the login action). */
export async function createSession(user: CurrentUser): Promise<void> {
  const value = await createSessionCookieValue(user);
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clears the session cookie — call from a Server Action (e.g. sign-out).
    No server-side revocation list exists (see module comment on proxy.ts's
    verification model), so this is the entire logout mechanism. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);
}

/** Reads and verifies the session cookie from the current request. Use in
    Server Components/Actions; returns null when signed out or the cookie
    fails verification. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(SESSION_COOKIE_NAME)?.value);
}

/** Same as getCurrentUser(), but throws when signed out — for write paths
    that need a cashier_id/created_by and have no sensible fallback. The
    login gate in proxy.ts means this should never actually throw in
    practice (every route reaching a Server Action is already
    authenticated), but it's a real check, not just a type assertion. */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

export { SESSION_COOKIE_NAME };
