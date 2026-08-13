import { NextResponse, type NextRequest } from "next/server";

import { safeRedirect } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single landing point for every Supabase email link: confirmation, magic link
 * and password recovery. Supabase sends either a PKCE `code` or a
 * `token_hash` + `type` pair depending on the template, so both are handled.
 *
 * The `next` destination is attacker-controlled and always passed through the
 * redirect allowlist.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeRedirect(searchParams.get("next"));

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    logger.warn("auth_callback_code_exchange_failed", { code: error.code });
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as
        "signup" | "magiclink" | "recovery" | "invite" | "email_change",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    logger.warn("auth_callback_otp_failed", { code: error.code });
  }

  const failure = new URL("/login", origin);
  failure.searchParams.set("error", "link_invalid");
  return NextResponse.redirect(failure);
}
