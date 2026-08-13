import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Responsibilities, in order:
 *  1. Refresh the Supabase auth cookie so Server Components see a live session.
 *  2. Gate the dashboard behind an authenticated user.
 *  3. Bounce authenticated users away from the auth pages.
 *
 * The user object here comes from `getUser()`, which validates the token with
 * Supabase - never trust the unverified cookie payload.
 */

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
const AUTH_ROUTES = ["/login", "/signup", "/forgot-password"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
        response = NextResponse.next({ request });
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
    return NextResponse.redirect(url);
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
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
