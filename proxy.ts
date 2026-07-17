import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (same capabilities;
 * `middleware()`/`config` became `proxy()`/`proxyConfig`).
 *
 * This runs before every matched request. It refreshes the auth token and
 * writes the rotated cookies back onto the response — without it you get
 * random logouts and hard-to-debug session bugs.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-Control/Expires/Pragma. A CDN caching a response that carries
          // auth cookies would serve one user's session token to another.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    }
  );

  // getClaims() verifies the JWT signature against the project's published
  // public keys. getSession() must not be trusted in server code — it reads
  // storage without revalidating.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);

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

  return response;
}

// Must be named `config`, even in proxy.ts — Next 16.2.10 reads the export
// literally named "config". A `proxyConfig` export is silently ignored, which
// makes the proxy run on every request (including /_next/static CSS).
export const config = {
  matcher: [
    /*
     * Everything except static assets and images. Auth cookies must still be
     * refreshed on most requests, so keep this broad.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
