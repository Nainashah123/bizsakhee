import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/session";
import {
  buildAuthorizationUrl,
  createOAuthState,
  META_OAUTH_STATE_COOKIE,
  metaOAuthStatus,
  OAUTH_STATE_TTL_MS,
} from "@/lib/integrations/meta/oauth";
import { logger } from "@/lib/logger";
import { httpStatusFor } from "@/lib/result";

/**
 * Starts a Meta channel connection.
 *
 * GET /api/meta/oauth/start?provider=whatsapp|instagram
 *   302  to Meta's authorisation dialog, with an httpOnly nonce cookie
 *   4xx  { "error": "<code>", "message": "..." } for a caller who may not do this
 *   503  { "error": "not_configured", "missing": ["META_APP_ID", ...] }
 *
 * Owner and admin only: `integrations.manage`. The workspace is resolved from
 * the session, never from the query string, and it is the resolved id that goes
 * into the signed state.
 *
 * The nonce cookie is what binds the flow to this browser. It is httpOnly,
 * SameSite=Lax - the return trip is a top-level navigation from facebook.com,
 * which Strict would drop - and scoped to the OAuth path so it is not attached
 * to any other request.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerSchema = z.enum(["whatsapp", "instagram"]);

function fail(
  code: Parameters<typeof httpStatusFor>[0],
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: code, message, ...extra },
    { status: httpStatusFor(code), headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const status = metaOAuthStatus();
  if (!status.ready) {
    // Honest setup state: no half-built dialog URL, no pretending.
    return fail(
      "not_configured",
      "Meta is not configured on this deployment yet, so channels cannot be connected.",
      { missing: status.missing },
    );
  }

  const provider = providerSchema.safeParse(
    new URL(request.url).searchParams.get("provider"),
  );
  if (!provider.success) {
    return fail("validation", "Choose either WhatsApp or Instagram.");
  }

  const authorized = await requireCapability("integrations.manage");
  if (!authorized.ok) {
    return fail(authorized.error.code, authorized.error.message);
  }

  const state = createOAuthState({
    workspaceId: authorized.data.workspace.id,
    provider: provider.data,
  });
  if (!state.ok) return fail(state.error.code, state.error.message);

  const url = buildAuthorizationUrl({
    provider: provider.data,
    state: state.data.state,
  });
  if (!url.ok) return fail(url.error.code, url.error.message);

  logger.info("meta_oauth_started", {
    workspaceId: authorized.data.workspace.id,
    provider: provider.data,
  });

  const response = NextResponse.redirect(url.data, 302);
  response.cookies.set({
    name: META_OAUTH_STATE_COOKIE,
    value: state.data.nonce,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/meta/oauth",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });
  response.headers.set("cache-control", "no-store");

  return response;
}
