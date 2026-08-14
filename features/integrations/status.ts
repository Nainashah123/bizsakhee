import type {
  IntegrationProvider,
  IntegrationStatus,
} from "@/lib/supabase/database.types";

/**
 * Honest channel status.
 *
 * This module is deliberately pure and free of `server-only`, Supabase and
 * `process.env`: the rule it enforces - never show "Connected" for a channel
 * that cannot actually send a message - is the whole point of the Channels
 * screen, so it must be directly testable.
 *
 * The ordering below is the rule. Deployment configuration OUTRANKS the stored
 * row, because a row is just a memory of a connection that was made on some
 * deployment at some point. If this deployment has no Meta app credentials, or
 * no usable encryption key, it cannot talk to Meta and it could not have stored
 * a token safely - so a stale `status = 'connected'` row is a lie, and we say
 * "Setup required" instead.
 */

export type ChannelProvider = IntegrationProvider;

export type ChannelState =
  /** The deployment itself is not configured. Outranks whatever the row says. */
  | "setup_required"
  /** Configured deployment, but this workspace has never connected. */
  | "not_configured"
  /** A connection was started but is not usable yet. */
  | "pending"
  /** Configured deployment + connected row + a real provider account id. */
  | "connected"
  /** The last exchange with Meta failed. */
  | "error"
  /** Connected once, deliberately turned off. */
  | "disconnected";

/**
 * The non-secret parts of an `integrations` row. Token ciphertext is never
 * loaded for the UI, so it is not part of this shape.
 */
export type ChannelRow = {
  status: IntegrationStatus;
  externalAccountId: string | null;
  displayName: string | null;
  phoneNumberId: string | null;
  instagramUserId: string | null;
  connectedAt: string | null;
  lastError: string | null;
};

export type DeriveChannelStatusInput = {
  provider: ChannelProvider;
  /** All four META_* variables are present on this deployment. */
  envConfigured: boolean;
  /** Which META_* variables are missing, for the message. */
  missingEnv?: readonly string[];
  /** INTEGRATION_ENCRYPTION_KEY decodes to a usable 32-byte key. */
  encryptionConfigured: boolean;
  /** Why the key is unusable, straight from `integrationKeyStatus()`. */
  encryptionReason?: string;
  /** The stored row, or null when this workspace has none. */
  row: ChannelRow | null;
};

export type ChannelStatus = {
  state: ChannelState;
  /**
   * True only when this deployment can genuinely reach Meta for this channel.
   * Nothing in the UI may render a "Connected" affordance without it.
   */
  connected: boolean;
  /** One sentence, safe to show a seller. Never a raw provider error. */
  reason: string;
  /** False when pressing Connect could not possibly succeed. */
  canAttemptConnect: boolean;
  /** The provider account id we would actually send from, if we have one. */
  accountId: string | null;
  /** Human label for the connected account, if the provider gave us one. */
  accountLabel: string | null;
  /** ISO timestamp of the connection, only when genuinely connected. */
  connectedAt: string | null;
};

export const CHANNEL_LABELS: Record<ChannelProvider, string> = {
  whatsapp: "WhatsApp Business",
  instagram: "Instagram Messaging",
};

export const CHANNEL_STATE_LABELS: Record<ChannelState, string> = {
  setup_required: "Setup required",
  not_configured: "Not connected",
  pending: "Finishing setup",
  connected: "Connected",
  error: "Needs attention",
  disconnected: "Disconnected",
};

/** The account id that must exist before a channel can send anything. */
export const ACCOUNT_ID_LABELS: Record<ChannelProvider, string> = {
  whatsapp: "WhatsApp phone number id",
  instagram: "Instagram professional account id",
};

const DEFAULT_ENCRYPTION_REASON =
  "INTEGRATION_ENCRYPTION_KEY is missing or is not a 32-byte base64 key, so access tokens could not have been stored safely.";

/**
 * The id we would actually send from. Deliberately provider-specific and with
 * no fallback to `external_account_id`: a WhatsApp message needs a phone number
 * id, and an app-scoped user id is not a substitute for one.
 */
export function providerAccountId(
  provider: ChannelProvider,
  row: ChannelRow | null,
): string | null {
  if (!row) return null;
  const value =
    provider === "whatsapp" ? row.phoneNumberId : row.instagramUserId;
  return value && value.trim() !== "" ? value : null;
}

/**
 * Strips anything that looks like a credential, an id or a customer detail out
 * of a provider error before it reaches a screen.
 *
 * Meta's error strings routinely carry access tokens, phone numbers and trace
 * ids. We keep the shape of the message so it is still diagnosable, and drop
 * the parts that would leak.
 */
export function redactProviderError(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") {
    return "Meta reported a problem with this channel and did not say what it was.";
  }

  const redacted = raw
    // Anything after a URL's "?" is query string, which is where tokens live.
    .replace(/(https?:\/\/[^\s?]+)\?\S*/gi, "$1")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[redacted email]")
    // Long opaque runs: access tokens, app secrets, trace ids.
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    // Phone numbers and numeric account ids.
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[redacted number]")
    .replace(/\s+/g, " ")
    .trim();

  if (redacted === "") {
    return "Meta reported a problem with this channel and did not say what it was.";
  }

  return redacted.length > 200 ? `${redacted.slice(0, 199)}…` : redacted;
}

function missingEnvSentence(missing: readonly string[]): string {
  if (missing.length === 0) {
    return "This deployment has no Meta app credentials, so it cannot connect to Meta.";
  }
  return `This deployment is missing ${missing.join(", ")}, so it cannot connect to Meta.`;
}

/**
 * The single source of truth for what a channel card may claim.
 *
 * Checks run in order of authority: deployment configuration first, then
 * encryption, then - and only then - the stored row.
 */
export function deriveChannelStatus(
  input: DeriveChannelStatusInput,
): ChannelStatus {
  const { provider, envConfigured, encryptionConfigured, row } = input;

  const base = {
    connected: false,
    canAttemptConnect: false,
    accountId: null,
    accountLabel: null,
    connectedAt: null,
  } as const;

  // 1. No Meta app on this deployment. A stored row cannot override this: the
  //    OAuth exchange, the Graph API calls and the webhook signature check all
  //    need these variables, so nothing this row remembers can work here.
  if (!envConfigured) {
    return {
      ...base,
      state: "setup_required",
      reason: missingEnvSentence(input.missingEnv ?? []),
    };
  }

  // 2. No usable encryption key. Even if Meta handed us a token we could not
  //    store it safely, and any token already stored cannot be decrypted.
  if (!encryptionConfigured) {
    return {
      ...base,
      state: "setup_required",
      reason: input.encryptionReason ?? DEFAULT_ENCRYPTION_REASON,
    };
  }

  // 3. The deployment is ready, so from here the row is the truth.
  if (!row) {
    return {
      ...base,
      state: "not_configured",
      canAttemptConnect: true,
      reason: `${CHANNEL_LABELS[provider]} has not been connected for this workspace yet.`,
    };
  }

  const accountId = providerAccountId(provider, row);
  const accountLabel = row.displayName?.trim() || null;

  switch (row.status) {
    case "connected": {
      // A "connected" row with no account id cannot send a message, so it is
      // not connected. This is a half-finished authorisation, not a success.
      if (!accountId) {
        return {
          ...base,
          state: "pending",
          canAttemptConnect: true,
          accountLabel,
          reason: `Meta authorised this workspace but did not return a ${ACCOUNT_ID_LABELS[provider]}, so nothing can be sent yet. Connect again and pick the account you message from.`,
        };
      }

      return {
        state: "connected",
        connected: true,
        canAttemptConnect: false,
        accountId,
        accountLabel,
        connectedAt: row.connectedAt,
        reason: `Messages sent to ${accountLabel ?? CHANNEL_LABELS[provider]} arrive in this workspace.`,
      };
    }

    case "pending":
      return {
        ...base,
        state: "pending",
        canAttemptConnect: true,
        accountLabel,
        reason:
          "This connection was started but never finished. Connect again to complete it.",
      };

    case "error":
      return {
        ...base,
        state: "error",
        canAttemptConnect: true,
        accountLabel,
        reason: redactProviderError(row.lastError),
      };

    case "disconnected":
      return {
        ...base,
        state: "disconnected",
        canAttemptConnect: true,
        accountLabel,
        reason:
          "This channel was disconnected. Meta is no longer delivering its messages here.",
      };

    case "not_configured":
    default:
      return {
        ...base,
        state: "not_configured",
        canAttemptConnect: true,
        reason: `${CHANNEL_LABELS[provider]} has not been connected for this workspace yet.`,
      };
  }
}
