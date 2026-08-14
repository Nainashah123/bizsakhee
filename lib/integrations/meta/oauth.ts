import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { secretsMatch } from "@/lib/integrations/crypto";
import {
  GRAPH_API_BASE,
  META_OAUTH_DIALOG_URL,
  type MetaChannel,
} from "@/lib/integrations/meta/types";
import {
  markIntegrationError,
  recordIntegrationEvent,
  saveIntegrationConnection,
  type IntegrationSummary,
} from "@/lib/integrations/store";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";

/**
 * Meta OAuth: authorisation URL, state, code exchange and account discovery.
 *
 * The state parameter is the CSRF defence for the whole flow, and it is easy to
 * get wrong. Two things guard it here:
 *
 *   1. It is SIGNED. The workspace id travels inside an HMAC-SHA256 payload
 *      keyed by the app secret, so a bare workspace id in a URL cannot be
 *      swapped for someone else's. It also carries an issue time and is
 *      rejected after ten minutes.
 *   2. It is BOUND to the browser that started the flow. A random nonce is
 *      written to an httpOnly cookie by the start route and repeated inside the
 *      signed payload; the callback requires both to agree. A signed state
 *      lifted from a victim's URL is useless without their cookie.
 *
 * The callback additionally re-checks the caller's membership and capability
 * for the workspace named in the state. The state proves the flow started here;
 * it is not by itself an authorisation.
 */

export const META_OAUTH_STATE_COOKIE = "bizsakhi_meta_oauth";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Permissions requested per channel. Deliberately minimal: each extra scope is
 * something a seller has to consent to and something a leaked token could do.
 */
export const OAUTH_SCOPES: Record<MetaChannel, string[]> = {
  whatsapp: [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
    "business_management",
  ],
  instagram: [
    "instagram_basic",
    "instagram_manage_messages",
    "pages_show_list",
    "pages_messaging",
    "business_management",
  ],
};

export type MetaOAuthStatus = { ready: boolean; missing: string[] };

/** Whether this deployment can run an OAuth flow at all. */
export function metaOAuthStatus(): MetaOAuthStatus {
  const env = serverEnv();
  const missing: string[] = [];

  if (!env.META_APP_ID) missing.push("META_APP_ID");
  if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!env.META_REDIRECT_URI) missing.push("META_REDIRECT_URI");

  return { ready: missing.length === 0, missing };
}

// --- State ----------------------------------------------------------------

const statePayloadSchema = z.object({
  /** Workspace id. */
  w: z.uuid(),
  /** Provider. */
  p: z.enum(["whatsapp", "instagram"]),
  /** Nonce, echoed from the httpOnly cookie. */
  n: z.string().min(16),
  /** Issued at, epoch milliseconds. */
  t: z.number().int().positive(),
});

export type OAuthState = {
  workspaceId: string;
  provider: MetaChannel;
  nonce: string;
  issuedAt: number;
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Builds a signed state and the nonce that must be stored in the cookie.
 *
 * Returns both halves: the caller puts `state` in the URL and `nonce` in an
 * httpOnly cookie. Neither is useful on its own.
 */
export function createOAuthState(input: {
  workspaceId: string;
  provider: MetaChannel;
  now?: Date;
}): Result<{ state: string; nonce: string }> {
  const secret = serverEnv().META_APP_SECRET;
  if (!secret) {
    return err("not_configured", "META_APP_SECRET is not configured.");
  }

  const nonce = randomBytes(24).toString("base64url");
  const payload = JSON.stringify({
    w: input.workspaceId,
    p: input.provider,
    n: nonce,
    t: (input.now ?? new Date()).getTime(),
  });

  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return ok({ state: `${encoded}.${sign(encoded, secret)}`, nonce });
}

/**
 * Verifies a state that came back from Meta.
 *
 * Every failure is the same shape: a forbidden Result with one message. The
 * caller must not learn which check failed - a signature, an expiry and a
 * nonce mismatch are all "start again".
 */
export function verifyOAuthState(
  state: string | null | undefined,
  options: { cookieNonce?: string | null; now?: Date } = {},
): Result<OAuthState> {
  const secret = serverEnv().META_APP_SECRET;
  if (!secret) {
    return err("not_configured", "META_APP_SECRET is not configured.");
  }

  const rejected = err(
    "forbidden",
    "That connection link is no longer valid. Start connecting the channel again.",
  );

  if (!state) return rejected;

  const separator = state.lastIndexOf(".");
  if (separator <= 0) return rejected;

  const encoded = state.slice(0, separator);
  const provided = state.slice(separator + 1);

  if (!/^[0-9a-f]{64}$/i.test(provided)) return rejected;

  const expected = Buffer.from(sign(encoded, secret), "utf8");
  const actual = Buffer.from(provided.toLowerCase(), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return rejected;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return rejected;
  }

  const payload = statePayloadSchema.safeParse(parsedJson);
  if (!payload.success) return rejected;

  const now = (options.now ?? new Date()).getTime();
  const age = now - payload.data.t;
  // A negative age means a clock skew or a forged timestamp; both are refused.
  if (age < -60_000 || age > OAUTH_STATE_TTL_MS) return rejected;

  // The signature proves we issued it; the cookie proves this browser did.
  if (options.cookieNonce !== undefined) {
    if (!secretsMatch(options.cookieNonce, payload.data.n)) return rejected;
  }

  return ok({
    workspaceId: payload.data.w,
    provider: payload.data.p,
    nonce: payload.data.n,
    issuedAt: payload.data.t,
  });
}

/** The Meta authorisation URL to send the seller to. */
export function buildAuthorizationUrl(input: {
  provider: MetaChannel;
  state: string;
}): Result<string> {
  const env = serverEnv();
  const status = metaOAuthStatus();
  if (!status.ready || !env.META_APP_ID || !env.META_REDIRECT_URI) {
    return err(
      "not_configured",
      `Meta is not configured on this deployment. Missing: ${status.missing.join(", ")}.`,
    );
  }

  const url = new URL(META_OAUTH_DIALOG_URL);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("redirect_uri", env.META_REDIRECT_URI);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES[input.provider].join(","));

  return ok(url.toString());
}

// --- Graph reads ----------------------------------------------------------

/**
 * GETs a Graph URL.
 *
 * The URL itself is never logged or returned: for the token exchange it carries
 * the app secret, and for discovery it carries an access token.
 */
async function graphGet(
  url: URL,
  accessToken?: string,
): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: accessToken
        ? { authorization: `Bearer ${accessToken}` }
        : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return err("upstream_error", "Meta could not be reached.");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    logger.warn("meta_graph_get_failed", {
      status: response.status,
      path: url.pathname,
    });
    return err("upstream_error", "Meta rejected this request.");
  }

  return ok(body);
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export type MetaToken = {
  /** Plaintext. Encrypt before storing; never log or return to a client. */
  accessToken: string;
  expiresAt: string | null;
};

/** Exchanges the authorisation code for a short-lived user access token. */
export async function exchangeCodeForToken(
  code: string,
  options: { now?: Date } = {},
): Promise<Result<MetaToken>> {
  const env = serverEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    return err("not_configured", "Meta is not configured on this deployment.");
  }

  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("client_secret", env.META_APP_SECRET);
  url.searchParams.set("redirect_uri", env.META_REDIRECT_URI);
  url.searchParams.set("code", code);

  const response = await graphGet(url);
  if (!response.ok) return response;

  const parsed = tokenResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    return err("upstream_error", "Meta returned an unexpected token response.");
  }

  return ok(toToken(parsed.data, options.now ?? new Date()));
}

/**
 * Trades a short-lived token for a long-lived one (about 60 days).
 *
 * A short-lived token expires in an hour, which would make every channel break
 * the same afternoon it was connected.
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  options: { now?: Date } = {},
): Promise<Result<MetaToken>> {
  const env = serverEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return err("not_configured", "Meta is not configured on this deployment.");
  }

  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("client_secret", env.META_APP_SECRET);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const response = await graphGet(url);
  if (!response.ok) return response;

  const parsed = tokenResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    return err("upstream_error", "Meta returned an unexpected token response.");
  }

  return ok(toToken(parsed.data, options.now ?? new Date()));
}

function toToken(
  data: z.infer<typeof tokenResponseSchema>,
  now: Date,
): MetaToken {
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(now.getTime() + data.expires_in * 1000).toISOString()
      : null,
  };
}

// --- Account discovery ----------------------------------------------------

export type DiscoveredAccount = {
  externalAccountId: string | null;
  displayName: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  instagramUserId?: string | null;
  scopes: string[];
};

const debugTokenSchema = z.object({
  data: z
    .object({
      is_valid: z.boolean().optional(),
      user_id: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      granular_scopes: z
        .array(
          z.object({
            scope: z.string(),
            target_ids: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const phoneNumbersSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        display_phone_number: z.string().optional(),
        verified_name: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Finds the WhatsApp business account and phone number this token can send
 * from.
 *
 * Returns `ok(null)` when the grant carries no WhatsApp account: that is a
 * normal outcome for a seller who has not finished Meta's own onboarding, and
 * it must not be reported as a broken connection.
 */
export async function discoverWhatsAppAccount(
  accessToken: string,
): Promise<Result<DiscoveredAccount | null>> {
  const env = serverEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return err("not_configured", "Meta is not configured on this deployment.");
  }

  const debugUrl = new URL(`${GRAPH_API_BASE}/debug_token`);
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set(
    "access_token",
    `${env.META_APP_ID}|${env.META_APP_SECRET}`,
  );

  const debug = await graphGet(debugUrl);
  if (!debug.ok) return debug;

  const parsedDebug = debugTokenSchema.safeParse(debug.data);
  if (!parsedDebug.success) return ok(null);

  const scopes = parsedDebug.data.data?.scopes ?? [];
  const wabaId = parsedDebug.data.data?.granular_scopes?.find(
    (entry) => entry.scope === "whatsapp_business_management",
  )?.target_ids?.[0];

  if (!wabaId) return ok(null);

  const numbersUrl = new URL(
    `${GRAPH_API_BASE}/${encodeURIComponent(wabaId)}/phone_numbers`,
  );
  const numbers = await graphGet(numbersUrl, accessToken);
  if (!numbers.ok) {
    // The business account is known even if the number list is not.
    return ok({
      externalAccountId: wabaId,
      displayName: null,
      wabaId,
      phoneNumberId: null,
      scopes,
    });
  }

  const parsedNumbers = phoneNumbersSchema.safeParse(numbers.data);
  const first = parsedNumbers.success
    ? parsedNumbers.data.data?.[0]
    : undefined;

  return ok({
    externalAccountId: wabaId,
    displayName: first?.verified_name ?? first?.display_phone_number ?? null,
    wabaId,
    phoneNumberId: first?.id ?? null,
    scopes,
  });
}

const accountsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        instagram_business_account: z
          .object({ id: z.string(), username: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Finds the Instagram professional account behind the granted Pages.
 *
 * `ok(null)` when the seller granted access but has no Instagram professional
 * account linked to a Page - again a real, non-error state.
 */
export async function discoverInstagramAccount(
  accessToken: string,
): Promise<Result<DiscoveredAccount | null>> {
  const url = new URL(`${GRAPH_API_BASE}/me/accounts`);
  url.searchParams.set(
    "fields",
    "id,name,instagram_business_account{id,username}",
  );

  const response = await graphGet(url, accessToken);
  if (!response.ok) return response;

  const parsed = accountsSchema.safeParse(response.data);
  if (!parsed.success) return ok(null);

  const page = parsed.data.data?.find(
    (entry) => entry.instagram_business_account?.id,
  );
  const igAccount = page?.instagram_business_account;
  if (!page || !igAccount) return ok(null);

  return ok({
    externalAccountId: page.id,
    displayName: igAccount.username ?? page.name ?? null,
    instagramUserId: igAccount.id,
    scopes: OAUTH_SCOPES.instagram,
  });
}

// --- Orchestration --------------------------------------------------------

export type ConnectResult = {
  integration: IntegrationSummary;
  /**
   * False when the token is stored but Meta has no usable account behind it
   * yet. The channel is saved as `pending` in that case: claiming "Connected"
   * for a channel that can neither send nor receive would be a lie.
   */
  accountReady: boolean;
};

/**
 * Completes a channel connection: code -> long-lived token -> account ->
 * encrypted row.
 *
 * The caller must already have verified the state and the user's capability for
 * this workspace. On any failure the integration row is marked `error` with a
 * redacted reason so the UI can explain itself.
 */
export async function connectMetaChannel(input: {
  workspaceId: string;
  provider: MetaChannel;
  code: string;
  userId: string | null;
}): Promise<Result<ConnectResult>> {
  const shortLived = await exchangeCodeForToken(input.code);
  if (!shortLived.ok) {
    await failConnection(
      input,
      "The authorisation code could not be exchanged.",
    );
    return shortLived;
  }

  // Best effort: if the long-lived exchange fails we still have a working
  // short-lived token, and an hour of working channel beats a dead one.
  const longLived = await exchangeForLongLivedToken(
    shortLived.data.accessToken,
  );
  const token = longLived.ok ? longLived.data : shortLived.data;

  const discovered =
    input.provider === "whatsapp"
      ? await discoverWhatsAppAccount(token.accessToken)
      : await discoverInstagramAccount(token.accessToken);

  if (!discovered.ok) {
    await failConnection(
      input,
      "The connected Meta account could not be read.",
    );
    return discovered;
  }

  const account = discovered.data;
  const accountReady =
    input.provider === "whatsapp"
      ? Boolean(account?.phoneNumberId)
      : Boolean(account?.instagramUserId);

  const saved = await saveIntegrationConnection({
    workspaceId: input.workspaceId,
    provider: input.provider,
    accessToken: token.accessToken,
    tokenExpiresAt: token.expiresAt,
    scopes: account?.scopes ?? OAUTH_SCOPES[input.provider],
    displayName: account?.displayName ?? null,
    externalAccountId: account?.externalAccountId ?? null,
    phoneNumberId: account?.phoneNumberId ?? null,
    wabaId: account?.wabaId ?? null,
    instagramUserId: account?.instagramUserId ?? null,
    connectedBy: input.userId,
    status: accountReady ? "connected" : "pending",
  });

  if (!saved.ok) return saved;

  await recordIntegrationEvent({
    workspaceId: input.workspaceId,
    integrationId: saved.data.id,
    provider: input.provider,
    eventType: `${input.provider}.oauth.connect`,
    outcome: "connected",
    succeeded: true,
  });

  logger.info("meta_oauth_connected", {
    workspaceId: input.workspaceId,
    provider: input.provider,
    accountReady,
  });

  return ok({ integration: saved.data, accountReady });
}

async function failConnection(
  input: { workspaceId: string; provider: MetaChannel },
  reason: string,
): Promise<void> {
  await markIntegrationError(input.workspaceId, input.provider, reason);
  await recordIntegrationEvent({
    workspaceId: input.workspaceId,
    provider: input.provider,
    eventType: `${input.provider}.oauth.connect`,
    outcome: "failed",
    succeeded: false,
    errorMessage: reason,
  });
  logger.warn("meta_oauth_failed", {
    workspaceId: input.workspaceId,
    provider: input.provider,
  });
}
