import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (same capabilities;
 * `middleware()`/`config` became `proxy()`/`proxyConfig`).
 *
 * Sole gate for "is anyone logged in": verifies the signed session cookie
 * (HMAC signature + expiry, no DB round trip — same "verify the signature,
 * don't trust unsigned data" principle the old Supabase `getClaims()` check
 * used) and redirects accordingly. Unlike the old Supabase session, this
 * cookie has a fixed expiry and isn't rotated per request, so there's no
 * cookie-rewrite plumbing needed here — just read, verify, redirect or pass
 * through.
 */
export async function proxy(request: NextRequest) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookieValue(cookieValue);
  const isSignedIn = user !== null;

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");

  if (!isSignedIn && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isSignedIn && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Must be named `config`, even in proxy.ts — Next 16.2.10 reads the export
// literally named "config". A `proxyConfig` export is silently ignored, which
// makes the proxy run on every request (including /_next/static CSS).
export const config = {
  matcher: [
    /*
     * Everything except static assets and images. `_vercel` is excluded so
     * Speed Insights beacons (/_vercel/speed-insights/*) aren't redirected to
     * /login, which would silently drop all metrics.
     */
    "/((?!_next/static|_next/image|_vercel|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
