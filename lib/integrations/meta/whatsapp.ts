import "server-only";

import { z } from "zod";

import {
  GRAPH_API_BASE,
  MAX_TEXT_LENGTH,
  type MetaChannel,
  type OutboundMessage,
  type SendReceipt,
} from "@/lib/integrations/meta/types";
import {
  getAccessToken,
  getIntegration,
  integrationAdminClient,
  recordIntegrationEvent,
  type IntegrationClient,
} from "@/lib/integrations/store";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";

/**
 * WhatsApp Cloud API: the customer service window, and outbound sends.
 *
 * The window is the rule that governs everything here. WhatsApp only permits a
 * free-form message within 24 hours of the customer's last message; after that
 * only a template Meta has already approved may be sent. We enforce that
 * ourselves rather than letting Meta reject the call, for two reasons: a
 * rejected send still costs the seller a confusing error, and repeated policy
 * violations put a business account at risk.
 *
 * The window helpers are pure and exported on their own so the inbox can grey
 * out the composer using exactly the rule the send service enforces - one
 * definition, not two that can drift.
 *
 * HUMAN APPROVAL. `sendWhatsAppMessage` requires `approvedByUserId`: the id of
 * the signed-in person who pressed Send. Nothing in this repository calls it
 * from a queue, a cron job, an AI generation path or a webhook handler, and
 * `lib/ai/*` does not import it. An AI draft reaches a customer only after a
 * human reads it and acts, which is what supplies that id.
 */

/** WhatsApp's customer service window: 24 hours from the customer's message. */
export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When the window opened by a customer message closes.
 *
 * Written to `conversations.customer_window_expires_at` on every inbound
 * message, so the latest message always extends the window.
 */
export function customerWindowExpiryFrom(
  customerMessageAt: string | Date,
): string | null {
  const sentAt = toDate(customerMessageAt);
  if (!sentAt) return null;
  return new Date(sentAt.getTime() + CUSTOMER_WINDOW_MS).toISOString();
}

/**
 * Whether a free-form message may be sent right now.
 *
 * A null expiry means no customer message has ever opened a window - not that
 * the window is open. Expiry is exclusive: at the exact millisecond the window
 * ends it is closed, because that is how Meta treats it.
 */
export function isWithinCustomerWindow(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const expiry = toDate(expiresAt);
  if (!expiry) return false;
  return now.getTime() < expiry.getTime();
}

/** Milliseconds of window left; 0 when it is closed or was never opened. */
export function customerWindowRemainingMs(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): number {
  const expiry = toDate(expiresAt);
  if (!expiry) return 0;
  return Math.max(0, expiry.getTime() - now.getTime());
}

export type SendPolicy = {
  /** True when a free-form reply is allowed. */
  freeFormAllowed: boolean;
  /** True when only an approved template may be sent. */
  templateRequired: boolean;
  remainingMs: number;
  /** Null when the customer has never messaged this workspace. */
  expiresAt: string | null;
};

/** What the composer is allowed to offer, from the conversation's expiry. */
export function describeSendPolicy(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): SendPolicy {
  const open = isWithinCustomerWindow(expiresAt, now);
  const expiry = toDate(expiresAt);

  return {
    freeFormAllowed: open,
    templateRequired: !open,
    remainingMs: customerWindowRemainingMs(expiresAt, now),
    expiresAt: expiry ? expiry.toISOString() : null,
  };
}

export const TEMPLATE_REQUIRED_MESSAGE =
  "This customer last wrote more than 24 hours ago, so WhatsApp only allows an approved template message now. Pick a template to reply.";

const NO_WINDOW_MESSAGE =
  "This customer has not messaged you on WhatsApp yet, so WhatsApp only allows an approved template message. Pick a template to start the conversation.";

/**
 * The guard the send service runs before a free-form message.
 *
 * Exported so a Server Action can fail fast with the same wording the service
 * would use, and so the rule is directly testable.
 */
export function assertFreeFormAllowed(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): Result<null> {
  if (isWithinCustomerWindow(expiresAt, now)) return ok(null);

  return err(
    "validation",
    expiresAt ? TEMPLATE_REQUIRED_MESSAGE : NO_WINDOW_MESSAGE,
  );
}

// --- Graph transport ------------------------------------------------------

/** Meta is not allowed to hold a Server Action open indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

export type GraphOutcome =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number;
      /** Meta's numeric error code, as a string. Never their prose. */
      code: string | null;
      /** Short redacted message, for the operator-facing audit row only. */
      message: string | null;
      /** True when trying again later could plausibly succeed. */
      retryable: boolean;
    };

const graphErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.union([z.number(), z.string()]).optional(),
      error_subcode: z.union([z.number(), z.string()]).optional(),
    })
    .optional(),
});

/**
 * POSTs to the Graph API with a bearer token.
 *
 * Shared with `instagram.ts` - the two channels differ in payload and endpoint,
 * not in transport. The token is passed straight into the header and never
 * touches a log line, a Result or an error message.
 */
export async function graphPost(
  path: string,
  accessToken: string,
  payload: unknown,
): Promise<GraphOutcome> {
  let response: Response;

  try {
    response = await fetch(`${GRAPH_API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Network failure or timeout. Nothing from the exception is surfaced: it
    // can contain the full request URL.
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: "Meta could not be reached.",
      retryable: true,
    };
  }

  const raw = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  if (response.ok) return { ok: true, status: response.status, body };

  const parsed = graphErrorSchema.safeParse(body);
  const metaError = parsed.success ? parsed.data.error : undefined;

  return {
    ok: false,
    status: response.status,
    code: metaError?.code === undefined ? null : String(metaError.code),
    message: metaError?.message ?? null,
    // 429 and 5xx are transient; a 4xx means the request itself is wrong.
    retryable: response.status === 429 || response.status >= 500,
  };
}

const sendResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

// --- Send -----------------------------------------------------------------

const textBodySchema = z
  .string()
  .trim()
  .min(1, "Write a message before sending.")
  .max(MAX_TEXT_LENGTH, `Keep it under ${MAX_TEXT_LENGTH} characters.`);

const templateNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(
    /^[a-z0-9_]+$/,
    "A WhatsApp template name is lowercase letters, numbers and underscores.",
  );

export type SendWhatsAppInput = {
  workspaceId: string;
  /** Recipient in normalised form: digits with country code, no plus. */
  toPhone: string;
  message: OutboundMessage;
  /** Conversation to file the sent message under. Null skips persistence. */
  conversationId?: string | null;
  /**
   * The signed-in user who chose to send this. Required - see the human
   * approval note at the top of this file.
   */
  approvedByUserId: string;
  /** `conversations.customer_window_expires_at`, read by the caller. */
  windowExpiresAt: string | null;
  now?: Date;
};

function buildPayload(to: string, message: OutboundMessage): unknown {
  if (message.kind === "text") {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      // Link previews are off: they leak a fetch of whatever URL is in the body.
      text: { preview_url: false, body: message.body },
    };
  }

  const variables = message.variables ?? [];

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: message.templateName,
      language: { code: message.language },
      ...(variables.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: variables.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  };
}

/**
 * Sends one WhatsApp message.
 *
 * Order matters: validate, then check the window, then resolve the account,
 * then take the token. A refusal never reaches the network and never costs a
 * token read.
 *
 * Every outcome - refused, failed, sent - is written to `integration_events`
 * with a redacted summary. The message body is never part of it.
 */
export async function sendWhatsAppMessage(
  input: SendWhatsAppInput,
): Promise<Result<SendReceipt>> {
  const channel: MetaChannel = "whatsapp";
  const now = input.now ?? new Date();

  // 1. Shape.
  let payloadMessage: OutboundMessage;
  if (input.message.kind === "text") {
    const parsed = textBodySchema.safeParse(input.message.body);
    if (!parsed.success) {
      return err("validation", parsed.error.issues[0].message);
    }
    payloadMessage = { kind: "text", body: parsed.data };
  } else {
    const parsedName = templateNameSchema.safeParse(input.message.templateName);
    if (!parsedName.success) {
      return err("validation", parsedName.error.issues[0].message);
    }
    payloadMessage = {
      kind: "template",
      templateName: parsedName.data,
      language: input.message.language.trim() || "en",
      variables: input.message.variables,
    };
  }

  const to = input.toPhone.replace(/\D/g, "");
  if (to.length < 6) {
    return err("validation", "That phone number does not look complete.");
  }

  // 2. Policy. A free-form send outside the window is refused here, before any
  // network call - Meta would reject it anyway, and repeated violations count
  // against the business account.
  if (payloadMessage.kind === "text") {
    const allowed = assertFreeFormAllowed(input.windowExpiresAt, now);
    if (!allowed.ok) {
      await recordIntegrationEvent({
        workspaceId: input.workspaceId,
        provider: channel,
        eventType: "whatsapp.send.text",
        outcome: "refused",
        succeeded: false,
        errorCode: "outside_customer_window",
        conversationId: input.conversationId ?? null,
      });
      return allowed;
    }
  }

  // 3. Account. Read with the service role: a member may send, but only an
  // admin may read the integrations table through RLS.
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
      "WhatsApp is not connected for this workspace yet. Connect it in Settings to send messages.",
    );
  }

  const phoneNumberId = integration.data.phoneNumberId;
  if (!phoneNumberId) {
    return err(
      "not_configured",
      "No WhatsApp business number has been selected for this workspace yet.",
    );
  }

  // 4. Token, decrypted at the point of use and never held longer than the call.
  const token = await getAccessToken(input.workspaceId, channel);
  if (!token.ok) return token;

  // 5. Optimistic row, so a send that never comes back is still visible.
  const messageId = await insertPendingMessage(admin.data, {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId ?? null,
    body: payloadMessage.kind === "text" ? payloadMessage.body : null,
    templateName:
      payloadMessage.kind === "template" ? payloadMessage.templateName : null,
    sentBy: input.approvedByUserId,
    sentAt: now.toISOString(),
  });

  const outcome = await graphPost(
    `/${encodeURIComponent(phoneNumberId)}/messages`,
    token.data,
    buildPayload(to, payloadMessage),
  );

  const eventType =
    payloadMessage.kind === "text"
      ? "whatsapp.send.text"
      : "whatsapp.send.template";

  if (!outcome.ok) {
    await markMessageFailed(admin.data, messageId, outcome.code);
    await recordIntegrationEvent({
      workspaceId: input.workspaceId,
      integrationId: integration.data.id,
      provider: channel,
      eventType,
      outcome: "failed",
      succeeded: false,
      errorCode: outcome.code,
      errorMessage: outcome.message,
      httpStatus: outcome.status,
      conversationId: input.conversationId ?? null,
      templateName:
        payloadMessage.kind === "template" ? payloadMessage.templateName : null,
    });

    logger.warn("whatsapp_send_failed", {
      workspaceId: input.workspaceId,
      status: outcome.status,
      code: outcome.code,
    });

    return err(
      "upstream_error",
      outcome.retryable
        ? "WhatsApp could not be reached just now. Try again in a moment."
        : "WhatsApp rejected this message. Check the channel connection in Settings.",
    );
  }

  const parsed = sendResponseSchema.safeParse(outcome.body);
  const providerMessageId = parsed.success ? parsed.data.messages[0].id : null;

  await markMessageSent(admin.data, messageId, providerMessageId);

  await recordIntegrationEvent({
    workspaceId: input.workspaceId,
    integrationId: integration.data.id,
    provider: channel,
    eventType,
    outcome: "sent",
    succeeded: true,
    httpStatus: outcome.status,
    providerMessageId,
    conversationId: input.conversationId ?? null,
    templateName:
      payloadMessage.kind === "template" ? payloadMessage.templateName : null,
  });

  logger.info("whatsapp_send_ok", {
    workspaceId: input.workspaceId,
    templated: payloadMessage.kind === "template",
  });

  if (!providerMessageId) {
    // Accepted, but we cannot match delivery callbacks to it.
    return err(
      "upstream_error",
      "WhatsApp accepted the message but did not return an id, so its delivery cannot be tracked.",
    );
  }

  return ok({
    channel,
    providerMessageId,
    usedTemplate: payloadMessage.kind === "template",
    messageId,
  });
}

type PendingMessage = {
  workspaceId: string;
  conversationId: string | null;
  body: string | null;
  templateName: string | null;
  sentBy: string;
  sentAt: string;
};

/** Writes the outbound row as `pending`. Returns null when there is no thread. */
async function insertPendingMessage(
  client: IntegrationClient,
  message: PendingMessage,
): Promise<string | null> {
  if (!message.conversationId) return null;

  const { data, error } = await client
    .from("messages")
    .insert({
      workspace_id: message.workspaceId,
      conversation_id: message.conversationId,
      direction: "outbound",
      status: "pending",
      body: message.body,
      template_name: message.templateName,
      sent_by: message.sentBy,
      sent_at: message.sentAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.warn("outbound_message_row_failed", {
      workspaceId: message.workspaceId,
      code: error?.code,
    });
    return null;
  }

  return data.id;
}

async function markMessageSent(
  client: IntegrationClient,
  messageId: string | null,
  providerMessageId: string | null,
): Promise<void> {
  if (!messageId) return;

  const { error } = await client
    .from("messages")
    .update({ status: "sent", external_message_id: providerMessageId })
    .eq("id", messageId);

  if (error) {
    logger.warn("outbound_message_update_failed", { code: error.code });
  }
}

async function markMessageFailed(
  client: IntegrationClient,
  messageId: string | null,
  errorCode: string | null,
): Promise<void> {
  if (!messageId) return;

  const { error } = await client
    .from("messages")
    .update({ status: "failed", error_code: errorCode })
    .eq("id", messageId);

  if (error) {
    logger.warn("outbound_message_update_failed", { code: error.code });
  }
}
