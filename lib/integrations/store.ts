import "server-only";

import { serverEnv } from "@/lib/env";
import {
  decryptToken,
  encryptToken,
  integrationKeyStatus,
} from "@/lib/integrations/crypto";
import type { MetaChannel } from "@/lib/integrations/meta/types";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import type {
  IntegrationProvider,
  IntegrationStatus,
  Json,
} from "@/lib/supabase/database.types";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * The `integrations` row for a workspace: read, write, and token custody.
 *
 * Everything that touches a Meta access token goes through this module, and it
 * enforces three things the rest of the codebase then does not have to think
 * about.
 *
 *   1. Tokens are encrypted on the way in and decrypted only at the point of
 *      use. `IntegrationSummary` - the shape the UI receives - has no field
 *      that can hold one, so a token cannot reach a component by accident.
 *   2. Reads for the browser never select the ciphertext columns at all. RLS
 *      restricts the rows to workspace admins; the column list restricts what
 *      those admins get back.
 *   3. Writes use the service-role client. There is deliberately no INSERT or
 *      UPDATE policy on `integrations` for the `authenticated` role, so a
 *      compromised browser session cannot point a workspace at someone else's
 *      phone number id.
 *
 * Nothing here logs a token, a phone number or a customer identifier.
 */

/** A Supabase client bound either to the caller's session or to the service role. */
export type IntegrationClient = ReturnType<typeof createAdminClient>;

/**
 * Safe-to-render view of an integration. Note what is absent: no ciphertext, no
 * decrypted token, no refresh token.
 */
export type IntegrationSummary = {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  displayName: string | null;
  externalAccountId: string | null;
  /** WhatsApp: the id webhooks are routed by. Null until the account is chosen. */
  phoneNumberId: string | null;
  wabaId: string | null;
  instagramUserId: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  /** Short, redacted reason the last attempt failed. Never a provider payload. */
  lastError: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  updatedAt: string;
};

/** Just enough of a row to route a webhook event to a tenant. */
export type IntegrationRouting = {
  integrationId: string;
  workspaceId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  phoneNumberId: string | null;
  instagramUserId: string | null;
};

const SAFE_COLUMNS =
  "id, workspace_id, provider, status, external_account_id, display_name, phone_number_id, waba_id, instagram_user_id, scopes, token_expires_at, last_error, connected_at, connected_by, updated_at";

type SafeRow = {
  id: string;
  workspace_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  external_account_id: string | null;
  display_name: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  instagram_user_id: string | null;
  scopes: string[] | null;
  token_expires_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  connected_by: string | null;
  updated_at: string;
};

function toSummary(row: SafeRow): IntegrationSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    status: row.status,
    displayName: row.display_name,
    externalAccountId: row.external_account_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    instagramUserId: row.instagram_user_id,
    scopes: row.scopes ?? [],
    tokenExpiresAt: row.token_expires_at,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    connectedBy: row.connected_by,
    updatedAt: row.updated_at,
  };
}

const MAX_ERROR_LENGTH = 180;

/**
 * Makes a failure safe to persist.
 *
 * Provider error strings occasionally embed an access token or an id. Anything
 * that looks like a long opaque secret is replaced before the text is stored,
 * and the result is truncated so a runaway message cannot fill the column.
 */
export function redactErrorText(input: string): string {
  const withoutSecrets = input
    .replace(/\b(EAA|IGQ|Bearer\s+)[A-Za-z0-9._-]{8,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9._-]{40,}\b/g, "[redacted]");

  return withoutSecrets.length > MAX_ERROR_LENGTH
    ? `${withoutSecrets.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : withoutSecrets;
}

/**
 * Deployment-level readiness. The UI renders a checklist from this rather than
 * showing a "Connect" button that could only ever fail.
 */
export function integrationSetupStatus(): {
  ready: boolean;
  missing: string[];
} {
  const env = serverEnv();
  const missing: string[] = [];

  if (!env.META_APP_ID) missing.push("META_APP_ID");
  if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!env.META_VERIFY_TOKEN) missing.push("META_VERIFY_TOKEN");
  if (!env.META_REDIRECT_URI) missing.push("META_REDIRECT_URI");
  if (!integrationKeyStatus().ok) missing.push("INTEGRATION_ENCRYPTION_KEY");
  if (!env.SUPABASE_SECRET_KEY) missing.push("SUPABASE_SECRET_KEY");

  return { ready: missing.length === 0, missing };
}

/**
 * The service-role client, as a Result.
 *
 * Writes here are impossible without it, and a missing key is a configuration
 * problem the operator can fix - not an exception to bubble into a page.
 */
export function integrationAdminClient(): Result<IntegrationClient> {
  if (!serverEnv().SUPABASE_SECRET_KEY) {
    return err(
      "not_configured",
      "SUPABASE_SECRET_KEY is not set, so channel connections cannot be stored.",
    );
  }
  try {
    return ok(createAdminClient());
  } catch {
    return err(
      "not_configured",
      "The service-role Supabase client could not be created.",
    );
  }
}

/** The workspace's row for one provider, or null when it has never connected. */
export async function getIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
  client?: IntegrationClient,
): Promise<Result<IntegrationSummary | null>> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("integrations")
    .select(SAFE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    logger.error("integration_read_failed", {
      workspaceId,
      provider,
      code: error.code,
    });
    return err("upstream_error", "Channel settings could not be loaded.");
  }

  return ok(data ? toSummary(data as SafeRow) : null);
}

/** Every channel row for a workspace, for the integrations screen. */
export async function listIntegrations(
  workspaceId: string,
  client?: IntegrationClient,
): Promise<Result<IntegrationSummary[]>> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("integrations")
    .select(SAFE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("provider", { ascending: true });

  if (error) {
    logger.error("integration_list_failed", {
      workspaceId,
      code: error.code,
    });
    return err("upstream_error", "Channel settings could not be loaded.");
  }

  return ok(((data ?? []) as SafeRow[]).map(toSummary));
}

/**
 * Whether a credential is actually stored, without reading it.
 *
 * Answers "is this really connected, or does it just say so?" for the UI. The
 * ciphertext never leaves this function.
 */
export async function hasStoredToken(
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<boolean> {
  const admin = integrationAdminClient();
  if (!admin.ok) return false;

  const { data, error } = await admin.data
    .from("integrations")
    .select("access_token_ciphertext")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();

  if (error || !data) return false;
  return Boolean(data.access_token_ciphertext);
}

/**
 * The decrypted access token for a connected channel.
 *
 * SERVER ONLY, and callers must treat the value as radioactive: pass it
 * straight to the Graph request, never log it, never return it from a Server
 * Action, never put it in a Result that reaches a component.
 */
export async function getAccessToken(
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<Result<string>> {
  const admin = integrationAdminClient();
  if (!admin.ok) return admin;

  const { data, error } = await admin.data
    .from("integrations")
    .select("status, access_token_ciphertext")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    logger.error("integration_token_read_failed", {
      workspaceId,
      provider,
      code: error.code,
    });
    return err("upstream_error", "Channel credentials could not be read.");
  }

  if (!data || !data.access_token_ciphertext) {
    return err(
      "not_configured",
      provider === "whatsapp"
        ? "WhatsApp is not connected for this workspace yet."
        : "Instagram is not connected for this workspace yet.",
    );
  }

  if (data.status !== "connected") {
    return err(
      "not_configured",
      "This channel is not connected. Reconnect it from Settings to send messages.",
    );
  }

  // Returns a Result of its own: a rotated key or a tampered row must surface
  // as "reconnect this channel", not as a crash inside a send.
  return decryptToken(data.access_token_ciphertext);
}

export type SaveConnectionInput = {
  workspaceId: string;
  provider: IntegrationProvider;
  /** Plaintext, encrypted here. Never persisted or logged in the clear. */
  accessToken: string;
  refreshToken?: string | null;
  /** Absolute expiry, when the provider gives one. */
  tokenExpiresAt?: string | null;
  scopes?: string[];
  displayName?: string | null;
  externalAccountId?: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  instagramUserId?: string | null;
  connectedBy?: string | null;
  /**
   * `connected` once the account this channel will send from is known;
   * `pending` when the token is stored but the account still has to be chosen,
   * because a channel with no account id can neither send nor receive.
   */
  status?: Extract<IntegrationStatus, "connected" | "pending">;
};

/**
 * Stores a connection, encrypting the credentials on the way in.
 *
 * Upserts on (workspace_id, provider), which the table already enforces, so
 * reconnecting replaces the old credential rather than accumulating rows.
 */
export async function saveIntegrationConnection(
  input: SaveConnectionInput,
): Promise<Result<IntegrationSummary>> {
  const keyStatus = integrationKeyStatus();
  if (!keyStatus.ok) {
    // The honest failure: we will not store a token we cannot protect.
    return err("not_configured", keyStatus.reason);
  }

  const admin = integrationAdminClient();
  if (!admin.ok) return admin;

  let accessCiphertext: string;
  let refreshCiphertext: string | null = null;
  try {
    accessCiphertext = encryptToken(input.accessToken);
    if (input.refreshToken) {
      refreshCiphertext = encryptToken(input.refreshToken);
    }
  } catch {
    logger.error("integration_encrypt_failed", {
      workspaceId: input.workspaceId,
      provider: input.provider,
    });
    return err(
      "not_configured",
      "The integration encryption key is not usable, so this connection was not saved.",
    );
  }

  const status = input.status ?? "connected";

  const { data, error } = await admin.data
    .from("integrations")
    .upsert(
      {
        workspace_id: input.workspaceId,
        provider: input.provider,
        status,
        access_token_ciphertext: accessCiphertext,
        refresh_token_ciphertext: refreshCiphertext,
        token_expires_at: input.tokenExpiresAt ?? null,
        scopes: input.scopes ?? [],
        display_name: input.displayName ?? null,
        external_account_id: input.externalAccountId ?? null,
        phone_number_id: input.phoneNumberId ?? null,
        waba_id: input.wabaId ?? null,
        instagram_user_id: input.instagramUserId ?? null,
        connected_by: input.connectedBy ?? null,
        connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "workspace_id,provider" },
    )
    .select(SAFE_COLUMNS)
    .single();

  if (error || !data) {
    logger.error("integration_save_failed", {
      workspaceId: input.workspaceId,
      provider: input.provider,
      code: error?.code,
    });
    return err("upstream_error", "This connection could not be saved.");
  }

  logger.info("integration_connected", {
    workspaceId: input.workspaceId,
    provider: input.provider,
    status,
  });

  return ok(toSummary(data as SafeRow));
}

/**
 * Records that a channel is broken.
 *
 * Used by the OAuth callback and by any send that Meta rejects for an
 * authorisation reason, so the UI can say "reconnect" instead of silently
 * failing every send.
 */
export async function markIntegrationError(
  workspaceId: string,
  provider: IntegrationProvider,
  reason: string,
): Promise<Result<null>> {
  const admin = integrationAdminClient();
  if (!admin.ok) return admin;

  const { error } = await admin.data.from("integrations").upsert(
    {
      workspace_id: workspaceId,
      provider,
      status: "error" satisfies IntegrationStatus,
      last_error: redactErrorText(reason),
    },
    { onConflict: "workspace_id,provider" },
  );

  if (error) {
    logger.error("integration_mark_error_failed", {
      workspaceId,
      provider,
      code: error.code,
    });
    return err("upstream_error", "The channel status could not be updated.");
  }

  return ok(null);
}

/** Disconnects a channel and destroys the stored credentials. */
export async function disconnectIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<Result<null>> {
  const admin = integrationAdminClient();
  if (!admin.ok) return admin;

  const { error } = await admin.data
    .from("integrations")
    .update({
      status: "disconnected" satisfies IntegrationStatus,
      access_token_ciphertext: null,
      refresh_token_ciphertext: null,
      token_expires_at: null,
      last_error: null,
      connected_at: null,
    })
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);

  if (error) {
    logger.error("integration_disconnect_failed", {
      workspaceId,
      provider,
      code: error.code,
    });
    return err("upstream_error", "This channel could not be disconnected.");
  }

  logger.info("integration_disconnected", { workspaceId, provider });
  return ok(null);
}

/**
 * Finds the workspace an inbound event belongs to.
 *
 * The account id comes from the webhook envelope, and this lookup is the only
 * thing that turns it into a tenant. A miss is a legitimate outcome - Meta can
 * deliver events for an account that was disconnected here - and is reported as
 * `null`, never as an error, so the webhook can acknowledge and move on.
 */
export async function findIntegrationByAccount(
  channel: MetaChannel,
  accountId: string,
  client: IntegrationClient,
): Promise<Result<IntegrationRouting | null>> {
  const column =
    channel === "whatsapp" ? "phone_number_id" : "instagram_user_id";

  const { data, error } = await client
    .from("integrations")
    .select(
      "id, workspace_id, provider, status, phone_number_id, instagram_user_id",
    )
    .eq("provider", channel)
    .eq(column, accountId)
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("integration_routing_failed", {
      channel,
      code: error.code,
    });
    return err("upstream_error", "Channel routing lookup failed.");
  }

  if (!data) return ok(null);

  return ok({
    integrationId: data.id,
    workspaceId: data.workspace_id,
    provider: data.provider,
    status: data.status,
    phoneNumberId: data.phone_number_id,
    instagramUserId: data.instagram_user_id,
  });
}

/**
 * The audit trail for a channel.
 *
 * Deliberately narrow: a summary may describe what happened, never what was
 * said. There is no field here that can hold a message body, a phone number or
 * a customer name, which is what stops one from being logged by accident.
 */
export type IntegrationEventEntry = {
  workspaceId: string | null;
  integrationId?: string | null;
  provider: IntegrationProvider;
  /** e.g. "whatsapp.send.text", "instagram.token.refresh". */
  eventType: string;
  outcome:
    | "sent"
    | "failed"
    | "refused"
    | "received"
    | "ignored"
    | "connected"
    | "disconnected"
    | "refreshed";
  succeeded: boolean;
  /** Provider or internal error code. A code, not a sentence. */
  errorCode?: string | null;
  /** Short redacted explanation for an operator. Never a payload. */
  errorMessage?: string | null;
  providerMessageId?: string | null;
  conversationId?: string | null;
  templateName?: string | null;
  httpStatus?: number | null;
};

/**
 * Writes one audit row. Never throws and never fails a caller: an integration
 * that cannot be audited is still an integration that sent the message.
 */
export async function recordIntegrationEvent(
  entry: IntegrationEventEntry,
  client?: IntegrationClient,
): Promise<void> {
  const resolved = client ? ok(client) : integrationAdminClient();
  if (!resolved.ok) return;
  const supabase = resolved.data;

  const summary: Record<string, Json> = {
    channel: entry.provider,
    outcome: entry.outcome,
  };
  if (entry.errorCode) summary.errorCode = entry.errorCode;
  if (entry.providerMessageId) {
    summary.providerMessageId = entry.providerMessageId;
  }
  if (entry.conversationId) summary.conversationId = entry.conversationId;
  if (entry.templateName) summary.templateName = entry.templateName;
  if (typeof entry.httpStatus === "number") {
    summary.httpStatus = entry.httpStatus;
  }

  const { error } = await supabase.from("integration_events").insert({
    workspace_id: entry.workspaceId,
    integration_id: entry.integrationId ?? null,
    provider: entry.provider,
    event_type: entry.eventType,
    summary: summary as Json,
    succeeded: entry.succeeded,
    error_message: entry.errorMessage
      ? redactErrorText(entry.errorMessage)
      : null,
  });

  if (error) {
    logger.warn("integration_event_write_failed", {
      provider: entry.provider,
      eventType: entry.eventType,
      code: error.code,
    });
  }
}
