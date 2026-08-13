"use client";

import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let browserClient: BrowserClient | undefined;

/**
 * Browser Supabase client. Created lazily so that prerendering a page that
 * imports this module never evaluates environment variables at build time.
 */
export function createClient(): BrowserClient {
  if (!browserClient) {
    const env = clientEnv();
    browserClient = createBrowserClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  }
  return browserClient;
}
