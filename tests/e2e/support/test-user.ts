import { createClient } from "@supabase/supabase-js";

/**
 * Provisioning a signed-in user for the end-to-end journeys.
 *
 * Supabase confirms new accounts by email, which a headless browser cannot
 * click. There are two honest ways to get a usable account, tried in order:
 *
 *   1. SUPABASE_SECRET_KEY is set - create the user through the admin API with
 *      email_confirm: true. Fully automatic, no human step.
 *   2. E2E_EMAIL / E2E_PASSWORD are set - use an account somebody confirmed by
 *      hand.
 *
 * When neither is available the authenticated specs SKIP with the reason
 * printed. They are never silently passed: a skipped journey is reported as
 * not run, because claiming otherwise would be a lie about coverage.
 */

export type TestUser = {
  email: string;
  password: string;
  /** How the account was obtained, for the skip/diagnostic message. */
  source: "admin-api" | "environment";
};

export type ProvisionResult =
  { ok: true; user: TestUser } | { ok: false; reason: string };

const PASSWORD = "BizSakhiE2E!2026";

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  return { url, secret };
}

/** A unique address per run so tests never collide with each other. */
export function uniqueEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${noise}@bizsakhi-e2e.invalid`;
}

/**
 * Creates a confirmed user, or explains precisely why it could not.
 */
export async function provisionTestUser(
  fullName = "E2E Tester",
): Promise<ProvisionResult> {
  const { url, secret } = supabaseConfig();

  if (url && secret) {
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = uniqueEmail();
    const { error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (error) {
      return {
        ok: false,
        reason: `Supabase admin createUser failed: ${error.message}`,
      };
    }

    return {
      ok: true,
      user: { email, password: PASSWORD, source: "admin-api" },
    };
  }

  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (email && password) {
    return { ok: true, user: { email, password, source: "environment" } };
  }

  if (!url) {
    return {
      ok: false,
      reason:
        "NEXT_PUBLIC_SUPABASE_URL is not set, so there is no backend to sign in to.",
    };
  }

  return {
    ok: false,
    reason:
      "No confirmed account available. Set SUPABASE_SECRET_KEY to let the suite " +
      "create one automatically, or set E2E_EMAIL and E2E_PASSWORD to an account " +
      "you have already confirmed.",
  };
}

/** Best-effort cleanup so the project does not fill with test accounts. */
export async function deleteTestUser(email: string): Promise<void> {
  const { url, secret } = supabaseConfig();
  if (!url || !secret) return;

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const match = data?.users.find((user) => user.email === email);
  if (match) await admin.auth.admin.deleteUser(match.id);
}
