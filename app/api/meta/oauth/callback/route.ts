import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/auth/session";
import { absoluteUrl } from "@/lib/env";
import {
  connectMetaChannel,
  META_OAUTH_STATE_COOKIE,
  metaOAuthStatus,
  verifyOAuthState,
} from "@/lib/integrations/meta/oauth";
import { logger } from "@/lib/logger";

/**
 * Finishes a Meta channel connection.
 *
 * GET /api/meta/oauth/callback?code=…&state=…
 *   302 back to /dashboard/integrations with two query parameters the UI reads:
 *
 *     channel = whatsapp | instagram | unknown
 *     status  = connected      the channel is live
 *               pending        the token is stored, but Meta has no usable
 *                              account behind it yet, so nothing can send or
 *                              receive and the UI must not claim otherwise
 *               denied         the seller declined at Meta
 *               invalid_state  expired, forged, or a different browser
 *               forbidden      signed in, but not an owner or admin here
 *               failed         the exchange itself failed
 *
 *   503 JSON when Meta is not configured on this deployment.
 *
 * The state proves the flow started here; it is not authorisation. The user's
 * capability for the workspace named in the state is re-checked before anything
 * is written, so a stale link cannot connect a channel for a workspace the
 * signed-in user has since left.
 *
 * The one-time nonce cookie is cleared on every path out of this route,
 * including the failures.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome =
  "connected" | "pending" | "denied" | "invalid_state" | "forbidden" | "failed";

function back(channel: string, status: Outcome) {
  const url = new URL(absoluteUrl("/dashboard/integrations"));
  url.searchParams.set("channel", channel);
  url.searchParams.set("status", status);

  const response = NextResponse.redirect(url.toString(), 302);
  // One-time value: it must not survive this request whatever happened.
  response.cookies.set({
    name: META_OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/meta/oauth",
    maxAge: 0,
  });
  response.headers.set("cache-control", "no-store");

  return response;
}

export async function GET(request: Request) {
  const status = metaOAuthStatus();
  if (!status.ready) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Meta is not configured on this deployment yet, so channels cannot be connected.",
        missing: status.missing,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const params = new URL(request.url).searchParams;

  const cookieStore = await cookies();
  const nonce = cookieStore.get(META_OAUTH_STATE_COOKIE)?.value ?? null;

  // Meta reports a refusal in the query string rather than an error status.
  // `error_description` is Meta's prose and is never echoed back to the browser.
  if (params.get("error")) {
    logger.info("meta_oauth_denied", { reason: params.get("error") });
    return back("unknown", "denied");
  }

  const state = verifyOAuthState(params.get("state"), { cookieNonce: nonce });
  if (!state.ok) {
    logger.warn("meta_oauth_state_rejected");
    return back("unknown", "invalid_state");
  }

  const { workspaceId, provider } = state.data;

  // The state says which workspace; the session says whether this user may act
  // for it. Both have to agree.
  const authorized = await requireCapability(
    "integrations.manage",
    workspaceId,
  );
  if (!authorized.ok) {
    logger.warn("meta_oauth_forbidden", { provider });
    return back(provider, "forbidden");
  }

  const code = params.get("code");
  if (!code) {
    logger.warn("meta_oauth_missing_code", { provider });
    return back(provider, "failed");
  }

  const connected = await connectMetaChannel({
    workspaceId,
    provider,
    code,
    userId: authorized.data.user.id,
  });

  if (!connected.ok) {
    // `connectMetaChannel` has already stored a redacted `last_error` and
    // marked the integration as `error`, so the page can explain itself.
    return back(provider, "failed");
  }

  return back(provider, connected.data.accountReady ? "connected" : "pending");
}
