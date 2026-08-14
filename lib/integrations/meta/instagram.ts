import "server-only";

import { z } from "zod";

import {
  MAX_TEXT_LENGTH,
  type MetaChannel,
  type SendReceipt,
} from "@/lib/integrations/meta/types";
import {
  CUSTOMER_WINDOW_MS,
  graphPost,
  isWithinCustomerWindow,
} from "@/lib/integrations/meta/whatsapp";
import {
  getAccessToken,
  getIntegration,
  integrationAdminClient,
  markIntegrationError,
  recordIntegrationEvent,
  saveIntegrationConnection,
} from "@/lib/integrations/store";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";

/**
 * Instagram Messaging: replies to DMs, and long-lived token upkeep.
 *
 * Instagram has its own version of WhatsApp's customer service window. A
 * business may reply freely for 24 hours after the customer's last message.
 * Beyond that a reply is only allowed when it is genuinely a human answering -
 * Meta's HUMAN_AGENT tag, valid for seven days - and misusing that tag is a
 * policy violation, so it is opt-in per send and never applied automatically.
 *
 * There are no templates on Instagram, so once even the human agent window has
 * closed there is nothing to fall back to and the send is refused.
 *
 * HUMAN APPROVAL. Like WhatsApp, `sendInstagramReply` requires
 * `approvedByUserId`. Nothing calls it from a queue, a webhook or an AI path;
 * the tag exists precisely because a human is meant to be behind the reply.
 */

/** Meta's HUMAN_AGENT tag extends the reply window to seven days. */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Long-lived Instagram tokens last 60 days. Refresh once a token is inside its
 * last week, so a seller's channel does not die quietly over a weekend.
 */
export const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 10_000;

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether the HUMAN_AGENT tag can still carry a reply.
 *
 * `expiresAt` is the 24-hour expiry stored on the conversation, so the
 * customer's message was 24 hours before it and the seven-day deadline is six
 * days after it.
 */
export function isWithinHumanAgentWindow(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const expiry = toDate(expiresAt);
  if (!expiry) return false;

  const customerMessageAt = expiry.getTime() - CUSTOMER_WINDOW_MS;
  return now.getTime() < customerMessageAt + HUMAN_AGENT_WINDOW_MS;
}

/** True when a stored token is close enough to expiry to be worth refreshing. */
export function shouldRefreshToken(
  tokenExpiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const expiry = toDate(tokenExpiresAt);
  // An unknown expiry is not a reason to refresh on every request.
  if (!expiry) return false;
  return expiry.getTime() - now.getTime() < REFRESH_THRESHOLD_MS;
}

export type SendInstagramInput = {
  workspaceId: string;
  /** The Instagram-scoped id of the person being replied to. */
  recipientId: string;
  body: string;
  conversationId?: string | null;
  /** The signed-in user who pressed Send. Required. */
  approvedByUserId: string;
  /** `conversations.customer_window_expires_at`, read by the caller. */
  windowExpiresAt: string | null;
  /**
   * Opt in to Meta's HUMAN_AGENT tag for a reply after 24 hours. Only legal
   * when a person really is answering, so a caller must set it deliberately.
   */
  humanAgent?: boolean;
  now?: Date;
};

const bodySchema = z
  .string()
  .trim()
  .min(1, "Write a message before sending.")
  .max(MAX_TEXT_LENGTH, `Keep it under ${MAX_TEXT_LENGTH} characters.`);

const sendResponseSchema = z.object({
  message_id: z.string().min(1).optional(),
  recipient_id: z.string().optional(),
});

/**
 * Sends one Instagram reply.
 *
 * Refuses before touching the network when the messaging window has closed, and
 * records every outcome in `integration_events` with a redacted summary.
 */
export async function sendInstagramReply(
  input: SendInstagramInput,
): Promise<Result<SendReceipt>> {
  const channel: MetaChannel = "instagram";
  const now = input.now ?? new Date();

  const parsedBody = bodySchema.safeParse(input.body);
  if (!parsedBody.success) {
    return err("validation", parsedBody.error.issues[0].message);
  }

  const recipientId = input.recipientId.trim();
  if (recipientId === "") {
    return err("validation", "This conversation has no Instagram recipient.");
  }

  const insideStandardWindow = isWithinCustomerWindow(
    input.windowExpiresAt,
    now,
  );
  const useHumanAgentTag = !insideStandardWindow && input.humanAgent === true;

  if (!insideStandardWindow) {
    const canUseTag =
      input.humanAgent === true &&
      isWithinHumanAgentWindow(input.windowExpiresAt, now);

    if (!canUseTag) {
      await recordIntegrationEvent({
        workspaceId: input.workspaceId,
        provider: channel,
        eventType: "instagram.send.text",
        outcome: "refused",
        succeeded: false,
        errorCode: "outside_messaging_window",
        conversationId: input.conversationId ?? null,
      });

      return err(
        "validation",
        input.windowExpiresAt
          ? "Instagram only allows a reply within 24 hours of the customer's message, or up to seven days when a person is answering directly."
          : "Instagram replies are only possible after the customer messages you first.",
      );
    }
  }

  const admin = integrationAdminClient();
  if (!admin.ok) return admin;

  const integration = await getIntegration(
    input.workspaceId,
    channel,
    admin.data,
  );
  if (!integration.ok) return integration;

  if (!integration.data || integration.data.status !== "connected") {
    return err(
      "not_configured",
      "Instagram is not connected for this workspace yet. Connect it in Settings to reply from here.",
    );
  }

  const igUserId = integration.data.instagramUserId;
  if (!igUserId) {
    return err(
      "not_configured",
      "No Instagram professional account has been selected for this workspace yet.",
    );
  }

  const token = await getAccessToken(input.workspaceId, channel);
  if (!token.ok) return token;

  const outcome = await graphPost(
    `/${encodeURIComponent(igUserId)}/messages`,
    token.data,
    {
      recipient: { id: recipientId },
      message: { text: parsedBody.data },
      ...(useHumanAgentTag
        ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
        : { messaging_type: "RESPONSE" }),
    },
  );

  if (!outcome.ok) {
    await recordIntegrationEvent({
      workspaceId: input.workspaceId,
      integrationId: integration.data.id,
      provider: channel,
      eventType: "instagram.send.text",
      outcome: "failed",
      succeeded: false,
      errorCode: outcome.code,
      errorMessage: outcome.message,
      httpStatus: outcome.status,
      conversationId: input.conversationId ?? null,
    });

    logger.warn("instagram_send_failed", {
      workspaceId: input.workspaceId,
      status: outcome.status,
      code: outcome.code,
    });

    return err(
      "upstream_error",
      outcome.retryable
        ? "Instagram could not be reached just now. Try again in a moment."
        : "Instagram rejected this reply. Check the channel connection in Settings.",
    );
  }

  const parsed = sendResponseSchema.safeParse(outcome.body);
  const providerMessageId = parsed.success
    ? (parsed.data.message_id ?? null)
    : null;

  await recordIntegrationEvent({
    workspaceId: input.workspaceId,
    integrationId: integration.data.id,
    provider: channel,
    eventType: "instagram.send.text",
    outcome: "sent",
    succeeded: true,
    httpStatus: outcome.status,
    providerMessageId,
    conversationId: input.conversationId ?? null,
  });

  logger.info("instagram_send_ok", {
    workspaceId: input.workspaceId,
    humanAgentTag: useHumanAgentTag,
  });

  return ok({
    channel,
    providerMessageId: providerMessageId ?? "",
    usedTemplate: false,
    messageId: null,
  });
}

// --- Token upkeep ---------------------------------------------------------

/**
 * Instagram's own token endpoint. Not the Graph host: long-lived Instagram
 * tokens are refreshed against graph.instagram.com.
 */
const INSTAGRAM_TOKEN_HOST = "https://graph.instagram.com";

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

/**
 * Refreshes a long-lived Instagram token and re-encrypts it in place.
 *
 * Applies to tokens issued through Instagram login, which are refreshable while
 * they are still valid and at least 24 hours old. A token that has already
 * expired cannot be refreshed - the seller has to reconnect - and that is
 * reported honestly rather than retried forever.
 *
 * Safe to call speculatively: it returns `ok(false)` when nothing needed doing.
 */
export async function refreshInstagramToken(
  workspaceId: string,
  options: { force?: boolean; now?: Date } = {},
): Promise<Result<boolean>> {
  const now = options.now ?? new Date();
  const channel: MetaChannel = "instagram";

  const admin = integrationAdminClient();
  if (!admin.ok) return admin;

  const integration = await getIntegration(workspaceId, channel, admin.data);
  if (!integration.ok) return integration;

  if (!integration.data || integration.data.status !== "connected") {
    return err(
      "not_configured",
      "Instagram is not connected for this workspace.",
    );
  }

  if (
    !options.force &&
    !shouldRefreshToken(integration.data.tokenExpiresAt, now)
  ) {
    return ok(false);
  }

  const token = await getAccessToken(workspaceId, channel);
  if (!token.ok) return token;

  const url = new URL(`${INSTAGRAM_TOKEN_HOST}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token.data);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // The URL carries the token, so nothing about this failure is logged
    // beyond the fact of it.
    logger.warn("instagram_token_refresh_unreachable", { workspaceId });
    return err(
      "upstream_error",
      "Instagram could not be reached to refresh this connection.",
    );
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    await markIntegrationError(
      workspaceId,
      channel,
      "The Instagram connection expired and could not be refreshed.",
    );
    await recordIntegrationEvent({
      workspaceId,
      integrationId: integration.data.id,
      provider: channel,
      eventType: "instagram.token.refresh",
      outcome: "failed",
      succeeded: false,
      httpStatus: response.status,
    });

    logger.warn("instagram_token_refresh_failed", {
      workspaceId,
      status: response.status,
    });

    return err(
      "upstream_error",
      "This Instagram connection has expired. Reconnect it in Settings.",
    );
  }

  const parsed = refreshResponseSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "upstream_error",
      "Instagram returned an unexpected response while refreshing this connection.",
    );
  }

  const expiresAt = parsed.data.expires_in
    ? new Date(now.getTime() + parsed.data.expires_in * 1000).toISOString()
    : null;

  const saved = await saveIntegrationConnection({
    workspaceId,
    provider: channel,
    accessToken: parsed.data.access_token,
    tokenExpiresAt: expiresAt,
    scopes: integration.data.scopes,
    displayName: integration.data.displayName,
    externalAccountId: integration.data.externalAccountId,
    instagramUserId: integration.data.instagramUserId,
    connectedBy: integration.data.connectedBy,
    status: "connected",
  });

  if (!saved.ok) return saved;

  await recordIntegrationEvent({
    workspaceId,
    integrationId: integration.data.id,
    provider: channel,
    eventType: "instagram.token.refresh",
    outcome: "refreshed",
    succeeded: true,
  });

  logger.info("instagram_token_refreshed", { workspaceId });
  return ok(true);
}
