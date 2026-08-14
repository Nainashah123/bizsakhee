import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/contacts/normalize";
import {
  metaEventKey,
  metaEventType,
  normalizeMetaWebhook,
} from "@/lib/integrations/meta/normalize";
import {
  SIGNATURE_HEADER,
  verifyMetaChallenge,
  verifyMetaSignature,
} from "@/lib/integrations/meta/signature";
import {
  DELIVERY_STATUS_RANK,
  type NormalizedInboundMessage,
  type NormalizedStatusUpdate,
} from "@/lib/integrations/meta/types";
import { customerWindowExpiryFrom } from "@/lib/integrations/meta/whatsapp";
import {
  findIntegrationByAccount,
  integrationAdminClient,
  type IntegrationClient,
  type IntegrationRouting,
} from "@/lib/integrations/store";
import { logger } from "@/lib/logger";
import type { ConversationChannel } from "@/lib/supabase/database.types";

/**
 * Meta webhook endpoint - WhatsApp Cloud API and Instagram Messaging.
 *
 * GET  /api/meta/webhook   the subscription handshake. Echoes `hub.challenge`
 *                          as plain text when `hub.verify_token` matches.
 * POST /api/meta/webhook   message and delivery-status deliveries.
 *
 * The order of the POST handler is the correctness, and it follows the Stripe
 * endpoint in this repository:
 *
 *   1. Read the RAW body. `request.text()`, never `request.json()`: the HMAC
 *      covers the exact bytes Meta sent, and re-serialising JSON changes them.
 *   2. Verify the signature before parsing. An unsigned body is never parsed.
 *   3. Claim each event in `webhook_events` before doing its work. The unique
 *      index on (source, external_event_id) is what makes a replay a no-op.
 *   4. Route by account id to a workspace. An event for an account nobody here
 *      has connected is recorded and acknowledged - never a 500, because Meta
 *      retries 5xx and an unknown account would retry forever.
 *   5. Write the contact, conversation and message.
 *
 * A 5xx is reserved for failures a retry can genuinely fix, and in that case
 * the idempotency claim is released first - otherwise Meta's retry would hit
 * the unique index and skip the work permanently.
 *
 * Nothing here logs a payload, a message body, a phone number or a customer
 * name. Counts, event types, ids and error codes only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNIQUE_VIOLATION = "23505";
const WEBHOOK_SOURCE = "meta" as const;

function text(body: string, status: number) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Subscription handshake.
 *
 * Meta requires the challenge back as a bare string - a JSON-quoted value fails
 * verification, which is why this route does not use NextResponse.json.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const result = verifyMetaChallenge(params);

  if (!result.ok) {
    logger.warn("meta_webhook_challenge_rejected", { status: result.status });
    return text(
      result.status === 503
        ? "Meta webhooks are not configured on this deployment. Set META_VERIFY_TOKEN and redeploy."
        : "Verification failed.",
      result.status,
    );
  }

  logger.info("meta_webhook_challenge_ok");
  return text(result.challenge, 200);
}

export async function POST(request: Request) {
  // 1. Raw bytes, exactly as delivered.
  const rawBody = await request.text();

  // 2. Signature, before anything looks at the contents.
  const signature = verifyMetaSignature(
    rawBody,
    request.headers.get(SIGNATURE_HEADER),
  );

  if (!signature.valid) {
    // The reason is a fixed enum, never the header or the body.
    logger.warn("meta_webhook_signature_rejected", {
      reason: signature.reason,
    });

    if (signature.reason === "not_configured") {
      // Honest, and retryable once the secret is set.
      return json(
        {
          error: "not_configured",
          message:
            "META_APP_SECRET is not set, so webhook deliveries cannot be verified.",
        },
        503,
      );
    }

    return json({ error: "forbidden", message: "Invalid signature." }, 403);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but not JSON. A retry would deliver the same bytes, so this is
    // acknowledged rather than looped over.
    logger.warn("meta_webhook_unparseable");
    return json({ received: true, handled: false, reason: "unparseable" }, 200);
  }

  const normalized = normalizeMetaWebhook(payload);

  if (normalized.events.length === 0) {
    logger.info("meta_webhook_nothing_to_do", { skipped: normalized.skipped });
    return json(
      { received: true, handled: false, skipped: normalized.skipped },
      200,
    );
  }

  const admin = integrationAdminClient();
  if (!admin.ok) {
    logger.error("meta_webhook_missing_service_role");
    // Retrying after the key is configured genuinely helps, so let Meta retry.
    return json({ error: "not_configured", message: admin.error.message }, 503);
  }
  const supabase = admin.data;

  let stored = 0;
  let duplicates = 0;
  let ignored = 0;
  let failed = 0;

  for (const event of normalized.events) {
    const key = metaEventKey(event);
    const eventType = metaEventType(event);

    // 3. Claim. A duplicate delivery stops here.
    const { error: claimError } = await supabase.from("webhook_events").insert({
      source: WEBHOOK_SOURCE,
      external_event_id: key,
      event_type: eventType,
      status: "received",
    });

    if (claimError) {
      if (claimError.code === UNIQUE_VIOLATION) {
        duplicates += 1;
        continue;
      }
      logger.error("meta_webhook_claim_failed", {
        eventType,
        code: claimError.code,
      });
      failed += 1;
      continue;
    }

    // 4. Route. The account id from the envelope is the only thing that decides
    // which tenant this belongs to.
    const routing = await findIntegrationByAccount(
      event.channel,
      event.accountId,
      supabase,
    );

    if (!routing.ok) {
      await release(supabase, key);
      failed += 1;
      continue;
    }

    if (!routing.data) {
      await finish(supabase, key, "failed", null, "unknown_account");
      logger.warn("meta_webhook_unknown_account", { channel: event.channel });
      ignored += 1;
      continue;
    }

    // 5. Write.
    const outcome =
      event.kind === "message"
        ? await storeInboundMessage(supabase, routing.data, event)
        : await applyStatusUpdate(supabase, routing.data, event);

    if (outcome === "retryable") {
      // Release the claim, or Meta's retry would be swallowed as a duplicate.
      await release(supabase, key);
      failed += 1;
      continue;
    }

    await finish(
      supabase,
      key,
      "processed",
      routing.data.workspaceId,
      outcome === "ignored" ? "no_matching_message" : null,
    );

    if (outcome === "ignored") ignored += 1;
    else stored += 1;
  }

  const summary = {
    received: true,
    stored,
    duplicates,
    ignored,
    skipped: normalized.skipped,
    failed,
  };

  logger.info("meta_webhook_processed", summary);

  // Only a genuinely retryable failure asks Meta to come back.
  return json(summary, failed > 0 ? 500 : 200);
}

type WriteOutcome = "stored" | "ignored" | "retryable";

/** Contact -> conversation -> message, then the 24-hour window. */
async function storeInboundMessage(
  supabase: IntegrationClient,
  routing: IntegrationRouting,
  event: NormalizedInboundMessage,
): Promise<WriteOutcome> {
  const contactId = await resolveContact(supabase, routing, event);
  if (contactId === "retryable") return "retryable";

  const conversationId = await resolveConversation(
    supabase,
    routing,
    event,
    contactId,
  );
  if (conversationId === "retryable") return "retryable";

  const { error } = await supabase.from("messages").insert({
    workspace_id: routing.workspaceId,
    conversation_id: conversationId,
    direction: "inbound",
    // Inbound messages have no delivery lifecycle of their own; they have
    // simply arrived.
    status: "delivered",
    body: event.text,
    external_message_id: event.providerMessageId,
    sent_at: event.timestamp,
  });

  if (error && error.code !== UNIQUE_VIOLATION) {
    logger.error("meta_webhook_message_insert_failed", {
      workspaceId: routing.workspaceId,
      channel: event.channel,
      code: error.code,
    });
    return "retryable";
  }

  // A unique violation is the second line of defence behind `webhook_events`:
  // the message is already stored, so this delivery is done.
  const alreadyStored = Boolean(error);

  await touchConversation(supabase, {
    conversationId,
    workspaceId: routing.workspaceId,
    timestamp: event.timestamp,
    countAsUnread: !alreadyStored,
  });

  return "stored";
}

/**
 * Finds or creates the contact behind an inbound message.
 *
 * WhatsApp matches on the normalised phone, Instagram on the stored channel
 * handle, because an Instagram-scoped id is all Meta gives us.
 */
async function resolveContact(
  supabase: IntegrationClient,
  routing: IntegrationRouting,
  event: NormalizedInboundMessage,
): Promise<string | null | "retryable"> {
  if (event.channel === "whatsapp") {
    // `wa_id` is already international digits; the leading plus keeps
    // normalisation from treating it as a national number.
    const phone = normalizePhone(`+${event.senderId}`);
    if (!phone) return null;

    const existing = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", routing.workspaceId)
      .eq("phone_normalized", phone.normalized)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      logger.error("meta_webhook_contact_lookup_failed", {
        workspaceId: routing.workspaceId,
        code: existing.error.code,
      });
      return "retryable";
    }
    if (existing.data) return existing.data.id;

    const created = await supabase
      .from("contacts")
      .insert({
        workspace_id: routing.workspaceId,
        full_name: event.senderName ?? phone.display,
        phone_normalized: phone.normalized,
        phone_display: phone.display,
        lead_source: "whatsapp",
        last_contacted_at: event.timestamp,
      })
      .select("id")
      .single();

    if (created.error) {
      if (created.error.code === UNIQUE_VIOLATION) {
        // Two deliveries for a new customer arrived at once; the other won.
        const retry = await supabase
          .from("contacts")
          .select("id")
          .eq("workspace_id", routing.workspaceId)
          .eq("phone_normalized", phone.normalized)
          .limit(1)
          .maybeSingle();
        return retry.data?.id ?? null;
      }

      logger.error("meta_webhook_contact_insert_failed", {
        workspaceId: routing.workspaceId,
        code: created.error.code,
      });
      return "retryable";
    }

    return created.data.id;
  }

  const channelRow = await supabase
    .from("contact_channels")
    .select("contact_id")
    .eq("workspace_id", routing.workspaceId)
    .eq("kind", "instagram")
    .eq("handle", event.senderId)
    .limit(1)
    .maybeSingle();

  if (channelRow.error) {
    logger.error("meta_webhook_contact_lookup_failed", {
      workspaceId: routing.workspaceId,
      code: channelRow.error.code,
    });
    return "retryable";
  }
  if (channelRow.data) return channelRow.data.contact_id;

  const created = await supabase
    .from("contacts")
    .insert({
      workspace_id: routing.workspaceId,
      // Meta does not send a username on the messaging event, so the name is
      // an honest placeholder the seller can edit - not a guess.
      full_name:
        event.senderName ??
        `Instagram customer ${event.senderId.slice(-4)}`.trim(),
      lead_source: "instagram",
      last_contacted_at: event.timestamp,
    })
    .select("id")
    .single();

  if (created.error) {
    logger.error("meta_webhook_contact_insert_failed", {
      workspaceId: routing.workspaceId,
      code: created.error.code,
    });
    return "retryable";
  }

  const { error: channelError } = await supabase
    .from("contact_channels")
    .insert({
      workspace_id: routing.workspaceId,
      contact_id: created.data.id,
      kind: "instagram",
      handle: event.senderId,
      is_primary: true,
    });

  if (channelError && channelError.code !== UNIQUE_VIOLATION) {
    logger.warn("meta_webhook_channel_insert_failed", {
      workspaceId: routing.workspaceId,
      code: channelError.code,
    });
  }

  return created.data.id;
}

async function resolveConversation(
  supabase: IntegrationClient,
  routing: IntegrationRouting,
  event: NormalizedInboundMessage,
  contactId: string | null,
): Promise<string | "retryable"> {
  const channel: ConversationChannel = event.channel;

  const existing = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("workspace_id", routing.workspaceId)
    .eq("channel", channel)
    .eq("external_thread_id", event.threadId)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    logger.error("meta_webhook_conversation_lookup_failed", {
      workspaceId: routing.workspaceId,
      code: existing.error.code,
    });
    return "retryable";
  }

  if (existing.data) {
    // A thread that started before the contact existed gets linked now.
    if (!existing.data.contact_id && contactId) {
      await supabase
        .from("conversations")
        .update({ contact_id: contactId })
        .eq("id", existing.data.id);
    }
    return existing.data.id;
  }

  const created = await supabase
    .from("conversations")
    .insert({
      workspace_id: routing.workspaceId,
      contact_id: contactId,
      channel,
      external_thread_id: event.threadId,
      status: "open",
    })
    .select("id")
    .single();

  if (created.error) {
    if (created.error.code === UNIQUE_VIOLATION) {
      const retry = await supabase
        .from("conversations")
        .select("id")
        .eq("workspace_id", routing.workspaceId)
        .eq("channel", channel)
        .eq("external_thread_id", event.threadId)
        .limit(1)
        .maybeSingle();
      if (retry.data) return retry.data.id;
    }

    logger.error("meta_webhook_conversation_insert_failed", {
      workspaceId: routing.workspaceId,
      code: created.error.code,
    });
    return "retryable";
  }

  return created.data.id;
}

/**
 * Stamps the thread after an inbound message and reopens the 24-hour customer
 * service window from the message's own timestamp - not from now, which would
 * quietly extend the window when a delivery is retried hours later.
 */
async function touchConversation(
  supabase: IntegrationClient,
  input: {
    conversationId: string;
    workspaceId: string;
    timestamp: string;
    countAsUnread: boolean;
  },
): Promise<void> {
  const current = await supabase
    .from("conversations")
    .select("unread_count, last_message_at, customer_window_expires_at")
    .eq("id", input.conversationId)
    .maybeSingle();

  if (current.error || !current.data) {
    logger.warn("meta_webhook_conversation_touch_failed", {
      workspaceId: input.workspaceId,
      code: current.error?.code,
    });
    return;
  }

  const expiry = customerWindowExpiryFrom(input.timestamp);
  const existingExpiry = current.data.customer_window_expires_at;
  // Out-of-order deliveries must not shorten a window a later message opened.
  const nextExpiry =
    expiry && (!existingExpiry || expiry > existingExpiry)
      ? expiry
      : existingExpiry;

  const lastMessageAt = current.data.last_message_at;
  const nextLastMessageAt =
    !lastMessageAt || input.timestamp > lastMessageAt
      ? input.timestamp
      : lastMessageAt;

  const { error } = await supabase
    .from("conversations")
    .update({
      last_message_at: nextLastMessageAt,
      customer_window_expires_at: nextExpiry,
      // Read-modify-write: two simultaneous deliveries could under-count by
      // one, which is a cosmetic badge, not a correctness problem.
      unread_count: input.countAsUnread
        ? current.data.unread_count + 1
        : current.data.unread_count,
      status: "open",
    })
    .eq("id", input.conversationId);

  if (error) {
    logger.warn("meta_webhook_conversation_touch_failed", {
      workspaceId: input.workspaceId,
      code: error.code,
    });
  }
}

/**
 * Applies a delivery or read callback to the message it belongs to.
 *
 * Meta does not guarantee ordering, so a status only ever moves forwards: a
 * late `delivered` cannot undo a `read`.
 */
async function applyStatusUpdate(
  supabase: IntegrationClient,
  routing: IntegrationRouting,
  event: NormalizedStatusUpdate,
): Promise<WriteOutcome> {
  const existing = await supabase
    .from("messages")
    .select("id, status, delivered_at, read_at")
    .eq("workspace_id", routing.workspaceId)
    .eq("external_message_id", event.providerMessageId)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    logger.error("meta_webhook_status_lookup_failed", {
      workspaceId: routing.workspaceId,
      code: existing.error.code,
    });
    return "retryable";
  }

  if (!existing.data) {
    // A status for a message this workspace never stored - for example one sent
    // from the seller's phone. Recorded and acknowledged, never retried.
    return "ignored";
  }

  const currentRank =
    DELIVERY_STATUS_RANK[
      existing.data.status as keyof typeof DELIVERY_STATUS_RANK
    ] ?? 0;
  const nextRank = DELIVERY_STATUS_RANK[event.status];

  const update: {
    status?: NormalizedStatusUpdate["status"];
    delivered_at?: string;
    read_at?: string;
    error_code?: string | null;
  } = {};

  if (nextRank > currentRank) {
    update.status = event.status;
    if (event.status === "failed") update.error_code = event.errorCode;
  }

  // Timestamps are stamped even when the status does not advance, so a
  // `delivered` arriving after `read` still records when delivery happened.
  if (event.status === "delivered" && !existing.data.delivered_at) {
    update.delivered_at = event.timestamp;
  }
  if (event.status === "read") {
    if (!existing.data.read_at) update.read_at = event.timestamp;
    if (!existing.data.delivered_at) update.delivered_at = event.timestamp;
  }

  if (Object.keys(update).length === 0) return "ignored";

  const { error } = await supabase
    .from("messages")
    .update(update)
    .eq("id", existing.data.id);

  if (error) {
    logger.error("meta_webhook_status_update_failed", {
      workspaceId: routing.workspaceId,
      code: error.code,
    });
    return "retryable";
  }

  return "stored";
}

/** Closes out the idempotency row. Best effort: never fails the request. */
async function finish(
  supabase: IntegrationClient,
  key: string,
  status: "processed" | "failed",
  workspaceId: string | null,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("webhook_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      workspace_id: workspaceId,
      // A short machine-readable reason only.
      error_message: reason,
    })
    .eq("source", WEBHOOK_SOURCE)
    .eq("external_event_id", key);

  if (error) {
    logger.error("meta_webhook_finalise_failed", { code: error.code });
  }
}

/** Releases an idempotency claim so a retry is not swallowed as a duplicate. */
async function release(
  supabase: IntegrationClient,
  key: string,
): Promise<void> {
  const { error } = await supabase
    .from("webhook_events")
    .delete()
    .eq("source", WEBHOOK_SOURCE)
    .eq("external_event_id", key);

  if (error) {
    // Leave a failed marker rather than silently dropping the event.
    logger.error("meta_webhook_release_failed", { code: error.code });
    await finish(supabase, key, "failed", null, "processing_failed");
  }
}
