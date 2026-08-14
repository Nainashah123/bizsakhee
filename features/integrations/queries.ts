import "server-only";

import { serverEnv } from "@/lib/env";
import { integrationKeyStatus } from "@/lib/integrations/crypto";
import type { WorkspaceRole } from "@/lib/permissions";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  deriveChannelStatus,
  type ChannelProvider,
  type ChannelRow,
  type ChannelStatus,
} from "@/features/integrations/status";

/**
 * Reads for the Channels screen.
 *
 * Two separate truths are assembled here and kept separate on purpose:
 *
 *   1. Deployment configuration - which META_* variables and which encryption
 *      key this deployment actually has. This is local, cheap and reliable.
 *   2. The per-workspace `integrations` rows.
 *
 * `deriveChannelStatus` then combines them with configuration outranking the
 * row, so a workspace can never be shown as "Connected" on a deployment that
 * has no Meta app.
 */

export { deriveChannelStatus } from "@/features/integrations/status";

export const CHANNEL_PROVIDERS = ["whatsapp", "instagram"] as const;

/** The variables a Meta app needs before any channel can be connected. */
export const META_ENV_VARS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_VERIFY_TOKEN",
  "META_REDIRECT_URI",
] as const;

export type MetaEnvVar = (typeof META_ENV_VARS)[number];

export type MetaConfigState = {
  /** True when all four META_* variables are present. */
  configured: boolean;
  present: MetaEnvVar[];
  missing: MetaEnvVar[];
};

export type EncryptionConfigState = {
  configured: boolean;
  /** Names INTEGRATION_ENCRYPTION_KEY and says what is wrong with it. */
  reason: string | null;
};

export type ChannelSummary = {
  provider: ChannelProvider;
  /**
   * Null means genuinely unknown: the deployment is configured, so the answer
   * depends on the row, but the row could not be read. The card says
   * "Status unavailable" rather than guessing "Not connected".
   */
  status: ChannelStatus | null;
};

export type ChannelsOverview = {
  channels: ChannelSummary[];
  meta: MetaConfigState;
  encryption: EncryptionConfigState;
  /**
   * True when the deployment as a whole can connect a channel. Everything on
   * the page that offers to connect is gated on this.
   */
  deploymentReady: boolean;
  /** True when reading the rows failed. The page shows an error, not zeros. */
  readFailed: boolean;
  /**
   * True when this role is not allowed to read the rows and no trusted client
   * was available. We say so rather than reporting "not connected".
   */
  restricted: boolean;
};

/**
 * Which Meta variables this deployment has.
 *
 * Only presence is reported - a value is never returned, because these are
 * server secrets and this result is rendered.
 */
export function metaConfigState(): MetaConfigState {
  const env = serverEnv();
  const values: Record<MetaEnvVar, string | undefined> = {
    META_APP_ID: env.META_APP_ID,
    META_APP_SECRET: env.META_APP_SECRET,
    META_VERIFY_TOKEN: env.META_VERIFY_TOKEN,
    META_REDIRECT_URI: env.META_REDIRECT_URI,
  };

  const present = META_ENV_VARS.filter((name) => Boolean(values[name]));
  const missing = META_ENV_VARS.filter((name) => !values[name]);

  return {
    configured: missing.length === 0,
    present: [...present],
    missing: [...missing],
  };
}

/** Whether tokens could be encrypted at rest, and why not when they could not. */
export function encryptionConfigState(): EncryptionConfigState {
  const status = integrationKeyStatus();
  return status.ok
    ? { configured: true, reason: null }
    : { configured: false, reason: status.reason };
}

type IntegrationSelection = {
  provider: ChannelProvider;
  status: ChannelRow["status"];
  external_account_id: string | null;
  display_name: string | null;
  phone_number_id: string | null;
  instagram_user_id: string | null;
  connected_at: string | null;
  last_error: string | null;
};

const SELECTED_COLUMNS =
  "provider, status, external_account_id, display_name, phone_number_id, instagram_user_id, connected_at, last_error";

function toChannelRow(row: IntegrationSelection): ChannelRow {
  return {
    status: row.status,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    phoneNumberId: row.phone_number_id,
    instagramUserId: row.instagram_user_id,
    connectedAt: row.connected_at,
    lastError: row.last_error,
  };
}

/**
 * Loads the rows for one workspace.
 *
 * RLS only lets owners and admins select from `integrations`, so a member's
 * session client legitimately sees nothing. Rather than let that empty result
 * masquerade as "not connected", we read with the service-role client when one
 * is configured - the workspace id has already been resolved from the session
 * by the caller, so it is trusted - and otherwise report `restricted`.
 *
 * Token ciphertext is never selected: it has no business being in a render
 * tree.
 */
async function loadRows(
  workspaceId: string,
  role: WorkspaceRole,
): Promise<{
  rows: Map<ChannelProvider, ChannelRow>;
  readFailed: boolean;
  restricted: boolean;
}> {
  const empty = new Map<ChannelProvider, ChannelRow>();
  const hasServiceRole = Boolean(serverEnv().SUPABASE_SECRET_KEY);

  if (!hasServiceRole && role === "member") {
    return { rows: empty, readFailed: false, restricted: true };
  }

  const supabase = hasServiceRole ? createAdminClient() : await createClient();

  const { data, error } = await supabase
    .from("integrations")
    .select(SELECTED_COLUMNS)
    .eq("workspace_id", workspaceId);

  if (error) {
    return { rows: empty, readFailed: true, restricted: false };
  }

  const rows = new Map<ChannelProvider, ChannelRow>();
  for (const row of (data ?? []) as IntegrationSelection[]) {
    rows.set(row.provider, toChannelRow(row));
  }

  return { rows, readFailed: false, restricted: false };
}

/**
 * Everything the Channels screen renders.
 *
 * The role is passed in (already resolved from the session by the caller) so
 * this function can be honest about a read it was not permitted to make.
 */
export async function getChannelsOverview({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}): Promise<ChannelsOverview> {
  const meta = metaConfigState();
  const encryption = encryptionConfigState();
  const { rows, readFailed, restricted } = await loadRows(workspaceId, role);

  const deploymentReady = meta.configured && encryption.configured;

  // A read we failed to make, or were not allowed to make, is not evidence
  // that nothing is connected - so the status stays unknown rather than
  // collapsing to "Not connected". The deployment answer is still authoritative
  // when it is negative, because it does not depend on any row.
  const rowsUnknown = deploymentReady && (readFailed || restricted);

  const channels: ChannelSummary[] = CHANNEL_PROVIDERS.map((provider) => ({
    provider,
    status: rowsUnknown
      ? null
      : deriveChannelStatus({
          provider,
          envConfigured: meta.configured,
          missingEnv: meta.missing,
          encryptionConfigured: encryption.configured,
          encryptionReason: encryption.reason ?? undefined,
          row: rows.get(provider) ?? null,
        }),
  }));

  return {
    channels,
    meta,
    encryption,
    deploymentReady,
    readFailed,
    restricted,
  };
}
