import { z } from "zod";

import {
  type DeliveryStatus,
  type InboundMessageType,
  type MetaChannel,
  type NormalizedInboundMessage,
  type NormalizedMetaEvent,
  type NormalizedStatusUpdate,
  type NormalizedWebhook,
} from "@/lib/integrations/meta/types";

/**
 * Meta webhook payload -> normalised events.
 *
 * Pure: no I/O, no clock beyond an injectable `receivedAt`, no environment. It
 * is the one place that knows Meta's envelope, and it is the easiest part of
 * the integration to get wrong, so it is also the most heavily tested.
 *
 * Three rules shape the whole file.
 *
 *   1. Never throw. A webhook handler that crashes on an unexpected shape hands
 *      Meta a 5xx, and Meta retries 5xx for days. Anything unrecognised is
 *      counted as skipped and dropped.
 *   2. Validate per item, not per batch. Meta batches events; one malformed
 *      message must not discard the four valid ones delivered beside it.
 *   3. Take routing identifiers from the envelope, never from the sender. The
 *      account id decides which workspace an event belongs to, so it comes from
 *      `metadata.phone_number_id` / the entry id, not from anything the sender
 *      controls.
 *
 * Schemas are permissive on purpose: Meta adds fields constantly, and unknown
 * keys are ignored rather than treated as a validation failure. What is
 * required is only what we cannot function without - an id, a sender, an
 * account.
 */

const RECOGNISED_STATUSES: Record<string, DeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

const RECOGNISED_MESSAGE_TYPES: Record<string, InboundMessageType> = {
  text: "text",
  image: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  document: "document",
  sticker: "sticker",
  location: "location",
  contacts: "contacts",
  reaction: "reaction",
};

/** Provider timestamps: WhatsApp sends unix seconds as a string, Instagram ms. */
const timestampSchema = z.union([z.string(), z.number()]).optional();

const textPartSchema = z.object({ body: z.string().optional() }).optional();
const captionPartSchema = z
  .object({ caption: z.string().optional() })
  .optional();

const whatsappMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: timestampSchema,
  type: z.string().optional(),
  text: textPartSchema,
  image: captionPartSchema,
  video: captionPartSchema,
  document: captionPartSchema,
  audio: z.object({}).optional(),
  sticker: z.object({}).optional(),
  location: z.object({ name: z.string().optional() }).optional(),
  button: z.object({ text: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string().optional() }).optional(),
      list_reply: z.object({ title: z.string().optional() }).optional(),
    })
    .optional(),
  reaction: z.object({ emoji: z.string().optional() }).optional(),
});

const whatsappStatusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  timestamp: timestampSchema,
  recipient_id: z.string().optional(),
  errors: z
    .array(
      z.object({
        code: z.union([z.number(), z.string()]).optional(),
        title: z.string().optional(),
      }),
    )
    .optional(),
});

const whatsappValueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z
    .object({
      phone_number_id: z.string().optional(),
      display_phone_number: z.string().optional(),
    })
    .optional(),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().optional(),
        profile: z.object({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  // Parsed item by item below, so one bad element cannot void the batch.
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const instagramMessagingSchema = z.object({
  sender: z.object({ id: z.string().optional() }).optional(),
  recipient: z.object({ id: z.string().optional() }).optional(),
  timestamp: timestampSchema,
  message: z
    .object({
      mid: z.string().optional(),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      attachments: z
        .array(z.object({ type: z.string().optional() }))
        .optional(),
    })
    .optional(),
  read: z.object({ mid: z.string().optional() }).optional(),
  delivery: z.object({ mids: z.array(z.string()).optional() }).optional(),
  reaction: z.object({ mid: z.string().optional() }).optional(),
  postback: z.object({ mid: z.string().optional() }).optional(),
});

const entrySchema = z.object({
  id: z.string().optional(),
  time: timestampSchema,
  changes: z
    .array(z.object({ field: z.string().optional(), value: z.unknown() }))
    .optional(),
  messaging: z.array(z.unknown()).optional(),
});

const envelopeSchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.unknown()).optional(),
});

/** Seconds or milliseconds since the epoch, as string or number, to ISO 8601. */
function toIso(
  value: string | number | undefined,
  fallback: Date,
  unit: "seconds" | "milliseconds",
): string {
  if (value === undefined) return fallback.toISOString();

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback.toISOString();

  const ms = unit === "seconds" ? numeric * 1000 : numeric;
  const date = new Date(ms);
  // A provider clock far in the future, or a value in the wrong unit, would
  // otherwise poison a 24-hour window calculation.
  if (Number.isNaN(date.getTime())) return fallback.toISOString();

  return date.toISOString();
}

function trimmedOrNull(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The readable text of a WhatsApp message, whatever wrapper it arrived in. */
function whatsappText(
  message: z.infer<typeof whatsappMessageSchema>,
): string | null {
  return (
    trimmedOrNull(message.text?.body) ??
    trimmedOrNull(message.image?.caption) ??
    trimmedOrNull(message.video?.caption) ??
    trimmedOrNull(message.document?.caption) ??
    trimmedOrNull(message.interactive?.button_reply?.title) ??
    trimmedOrNull(message.interactive?.list_reply?.title) ??
    trimmedOrNull(message.button?.text) ??
    trimmedOrNull(message.reaction?.emoji) ??
    null
  );
}

function messageTypeOf(raw: string | undefined): InboundMessageType {
  if (!raw) return "unsupported";
  return RECOGNISED_MESSAGE_TYPES[raw] ?? "unsupported";
}

type Accumulator = { events: NormalizedMetaEvent[]; skipped: number };

function normalizeWhatsAppValue(
  rawValue: unknown,
  receivedAt: Date,
  out: Accumulator,
): void {
  const parsed = whatsappValueSchema.safeParse(rawValue);
  if (!parsed.success) {
    out.skipped += 1;
    return;
  }

  const value = parsed.data;
  const accountId = trimmedOrNull(value.metadata?.phone_number_id);

  const names = new Map<string, string>();
  for (const contact of value.contacts ?? []) {
    const waId = trimmedOrNull(contact.wa_id);
    const name = trimmedOrNull(contact.profile?.name);
    if (waId && name) names.set(waId, name);
  }

  for (const raw of value.messages ?? []) {
    const message = whatsappMessageSchema.safeParse(raw);
    // Without an account id there is no workspace to attribute this to, and
    // guessing would cross a tenant boundary. Drop it instead.
    if (!message.success || !accountId) {
      out.skipped += 1;
      continue;
    }

    const sender = message.data.from;
    const event: NormalizedInboundMessage = {
      kind: "message",
      channel: "whatsapp",
      accountId,
      providerMessageId: message.data.id,
      senderId: sender,
      senderName: names.get(sender) ?? null,
      threadId: sender,
      timestamp: toIso(message.data.timestamp, receivedAt, "seconds"),
      messageType: messageTypeOf(message.data.type),
      text: whatsappText(message.data),
    };
    out.events.push(event);
  }

  for (const raw of value.statuses ?? []) {
    const status = whatsappStatusSchema.safeParse(raw);
    if (!status.success || !accountId) {
      out.skipped += 1;
      continue;
    }

    const mapped = RECOGNISED_STATUSES[status.data.status];
    if (!mapped) {
      // "deleted", "warning" and anything Meta adds later.
      out.skipped += 1;
      continue;
    }

    const firstError = status.data.errors?.[0];
    const event: NormalizedStatusUpdate = {
      kind: "status",
      channel: "whatsapp",
      accountId,
      providerMessageId: status.data.id,
      status: mapped,
      timestamp: toIso(status.data.timestamp, receivedAt, "seconds"),
      recipientId: trimmedOrNull(status.data.recipient_id),
      errorCode:
        firstError?.code === undefined ? null : String(firstError.code),
    };
    out.events.push(event);
  }
}

function normalizeInstagramMessaging(
  raw: unknown,
  entryId: string | null,
  receivedAt: Date,
  out: Accumulator,
): void {
  const parsed = instagramMessagingSchema.safeParse(raw);
  if (!parsed.success) {
    out.skipped += 1;
    return;
  }

  const item = parsed.data;
  const senderId = trimmedOrNull(item.sender?.id);
  const recipientId = trimmedOrNull(item.recipient?.id);
  const timestamp = toIso(item.timestamp, receivedAt, "milliseconds");

  if (item.message) {
    // An echo is our own outbound send being read back. Storing it would
    // duplicate the row the send service already wrote.
    if (item.message.is_echo || item.message.is_deleted) {
      out.skipped += 1;
      return;
    }

    const mid = trimmedOrNull(item.message.mid);
    // On an inbound DM the business account is the recipient; the entry id is
    // the same account and is the more reliable of the two.
    const accountId = entryId ?? recipientId;

    if (!mid || !senderId || !accountId) {
      out.skipped += 1;
      return;
    }

    const attachmentType = item.message.attachments?.[0]?.type;
    const text = trimmedOrNull(item.message.text);

    const event: NormalizedInboundMessage = {
      kind: "message",
      channel: "instagram",
      accountId,
      providerMessageId: mid,
      senderId,
      // Instagram does not put a username on the messaging event; it needs a
      // separate Graph lookup, so we do not pretend to know it here.
      senderName: null,
      threadId: senderId,
      timestamp,
      messageType: text
        ? "text"
        : messageTypeOf(attachmentType ?? "unsupported"),
      text,
    };
    out.events.push(event);
    return;
  }

  // Status callbacks. Here the business account is the sender of the original
  // message, so the entry id is again the safest account identifier.
  const accountId = entryId ?? senderId;

  if (item.delivery?.mids?.length && accountId) {
    for (const mid of item.delivery.mids) {
      const trimmed = trimmedOrNull(mid);
      if (!trimmed) {
        out.skipped += 1;
        continue;
      }
      out.events.push({
        kind: "status",
        channel: "instagram",
        accountId,
        providerMessageId: trimmed,
        status: "delivered",
        timestamp,
        recipientId: senderId,
        errorCode: null,
      });
    }
    return;
  }

  const readMid = trimmedOrNull(item.read?.mid);
  if (readMid && accountId) {
    out.events.push({
      kind: "status",
      channel: "instagram",
      accountId,
      providerMessageId: readMid,
      status: "read",
      timestamp,
      recipientId: senderId,
      errorCode: null,
    });
    return;
  }

  // Reactions, postbacks, referrals, read receipts without a mid: understood,
  // not handled.
  out.skipped += 1;
}

export type NormalizeOptions = {
  /** Clock used when the provider omits a timestamp. Injected for tests. */
  receivedAt?: Date;
};

/**
 * Turns one Meta webhook delivery into normalised events.
 *
 * Returns an empty result - never an exception - for garbage, for a payload
 * from a product we do not handle, and for an empty batch.
 */
export function normalizeMetaWebhook(
  payload: unknown,
  options: NormalizeOptions = {},
): NormalizedWebhook {
  const receivedAt = options.receivedAt ?? new Date();
  const out: Accumulator = { events: [], skipped: 0 };

  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success || !envelope.data.entry?.length) {
    return { events: [], skipped: 0 };
  }

  for (const rawEntry of envelope.data.entry) {
    const entry = entrySchema.safeParse(rawEntry);
    if (!entry.success) {
      out.skipped += 1;
      continue;
    }

    const entryId = trimmedOrNull(entry.data.id);

    for (const change of entry.data.changes ?? []) {
      // WhatsApp also sends account_update, template_status_update and friends
      // through the same envelope. Only message traffic is handled here.
      if (change.field && change.field !== "messages") {
        out.skipped += 1;
        continue;
      }
      normalizeWhatsAppValue(change.value, receivedAt, out);
    }

    for (const messaging of entry.data.messaging ?? []) {
      normalizeInstagramMessaging(messaging, entryId, receivedAt, out);
    }
  }

  return out;
}

/**
 * The idempotency key stored in `webhook_events.external_event_id`.
 *
 * Meta does not give a delivery a stable id of its own, so the key is built
 * from what the event is about. Statuses include the status itself: `sent`,
 * `delivered` and `read` all arrive for the same message id, and keying on the
 * message alone would swallow every callback after the first.
 */
export function metaEventKey(event: NormalizedMetaEvent): string {
  const prefix: MetaChannel = event.channel;
  return event.kind === "message"
    ? `${prefix}:msg:${event.providerMessageId}`
    : `${prefix}:status:${event.status}:${event.providerMessageId}`;
}

/** Short, non-identifying label for `webhook_events.event_type` and logs. */
export function metaEventType(event: NormalizedMetaEvent): string {
  return event.kind === "message"
    ? `${event.channel}.message.${event.messageType}`
    : `${event.channel}.status.${event.status}`;
}
