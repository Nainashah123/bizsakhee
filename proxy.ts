import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
} from "@/lib/security/csp";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Responsibilities, in order:
 *  1. Refresh the Supabase auth cookie so Server Components see a live session.
 *  2. Gate the dashboard behind an authenticated user.
 *  3. Bounce authenticated users away from the auth pages.
 *  4. Attach the security headers, including a per-request CSP nonce.
 *
 * The user object here comes from `getUser()`, which validates the token with
 * Supabase - never trust the unverified cookie payload.
 */

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
const AUTH_ROUTES = ["/login", "/signup", "/forgot-password"];

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const csp = buildContentSecurityPolicy({
    supabaseUrl,
    isDevelopment: process.env.NODE_ENV !== "production",
  });

  const requestHeaders = new Headers(request.headers);

  function withSecurityHeaders(target: NextResponse): NextResponse {
    target.headers.set("content-security-policy", csp);
    for (const { key, value } of STATIC_SECURITY_HEADERS) {
      target.headers.set(key, value);
    }
    return target;
  }

  let response = withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
  );

  // Without Supabase configuration there is no session to refresh; let the page
  // render and surface the configuration error itself.
  if (!supabaseUrl || !supabaseKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = withSecurityHeaders(
          NextResponse.next({ request: { headers: requestHeaders } }),
        );
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirectTo", `${pathname}${search}`);
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, image optimisation and files with an
     * extension. Webhooks are excluded too: they carry no cookie session and
     * must not pay for a session refresh.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/meta/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml)$).*)",
  ],
};
