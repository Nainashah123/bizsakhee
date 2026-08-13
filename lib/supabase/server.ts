import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { clientEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Request-scoped Supabase client bound to the SSR cookie session.
 * Always use this for user-facing reads and writes so RLS applies.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = clientEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: the proxy refreshes the session
            // instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS - only for webhooks, cron jobs and other
 * trusted server paths that must act without a user session. Never import this
 * from a Client Component.
 */
export function createAdminClient() {
  const env = clientEnv();
  const secret = serverEnv().SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured. It is required for webhooks and cron jobs.",
    );
  }

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, secret, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Service-role client is stateless: never writes session cookies.
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
