/**
 * Normalised message shapes shared by WhatsApp Cloud API and Instagram
 * Messaging.
 *
 * Meta ships two quite different webhook envelopes - WhatsApp puts business
 * events under `entry[].changes[].value`, Instagram under `entry[].messaging[]`
 * - and two different send endpoints. Everything downstream of
 * `lib/integrations/meta/normalize.ts` works on the shapes in this file instead,
 * so the inbox, the contact matcher and the delivery-status writer are written
 * once rather than twice.
 *
 * These types are deliberately pure data: no secrets, no Supabase rows, no
 * provider payloads carried through verbatim. A normalised event holds only
 * what routing and persistence actually need.
 */

/**
 * Graph API version. Pinned rather than floating: Meta deprecates versions on a
 * schedule, and an unpinned URL would change behaviour under us without a
 * deploy. Bump deliberately, after reading the changelog.
 */
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const META_OAUTH_DIALOG_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

/** Channels this module speaks. Matches the `integration_provider` enum. */
export type MetaChannel = "whatsapp" | "instagram";

/**
 * What arrived, coarsely. Only `text` carries a body we can store; everything
 * else is recorded so the seller sees that something came in and can open the
 * thread in WhatsApp or Instagram itself.
 */
export type InboundMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "reaction"
  | "unsupported";

export type NormalizedInboundMessage = {
  kind: "message";
  channel: MetaChannel;
  /**
   * The business account the event was delivered to: the WhatsApp
   * `phone_number_id` or the Instagram professional account id. This is the
   * only thing that maps an event to a workspace - never a value from the
   * request body's own idea of who it belongs to.
   */
  accountId: string;
  /** Provider message id (`wamid.…` / Instagram `mid`). Idempotency key. */
  providerMessageId: string;
  /** The customer: WhatsApp `wa_id` (digits, country code included) or IGSID. */
  senderId: string;
  /** Profile name when the provider sends one. Never invented. */
  senderName: string | null;
  /** Stable thread key for `conversations.external_thread_id`. */
  threadId: string;
  /** ISO 8601, derived from the provider's timestamp. */
  timestamp: string;
  messageType: InboundMessageType;
  /** Text body or caption. Null when the message carries no readable text. */
  text: string | null;
};

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type NormalizedStatusUpdate = {
  kind: "status";
  channel: MetaChannel;
  accountId: string;
  /** The message this status is about - matches `messages.external_message_id`. */
  providerMessageId: string;
  status: DeliveryStatus;
  timestamp: string;
  /** Who the message was addressed to, when the provider says. */
  recipientId: string | null;
  /** Short provider error code for a failed send. Never a customer's text. */
  errorCode: string | null;
};

export type NormalizedMetaEvent =
  NormalizedInboundMessage | NormalizedStatusUpdate;

export type NormalizedWebhook = {
  events: NormalizedMetaEvent[];
  /**
   * Entries we understood well enough to know we do not handle them (echoes of
   * our own sends, postbacks, unknown fields). Counted so the webhook can log
   * "we saw 3 things and stored 1" without logging what they were.
   */
  skipped: number;
};

export function isInboundMessage(
  event: NormalizedMetaEvent,
): event is NormalizedInboundMessage {
  return event.kind === "message";
}

export function isStatusUpdate(
  event: NormalizedMetaEvent,
): event is NormalizedStatusUpdate {
  return event.kind === "status";
}

/**
 * Delivery statuses only ever move forwards. Meta does not guarantee ordering,
 * so a `delivered` callback can arrive after `read`; ranking lets the writer
 * refuse to walk a message backwards.
 */
export const DELIVERY_STATUS_RANK: Record<DeliveryStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  // A failure is terminal and outranks everything: if Meta says it failed, the
  // seller needs to see that, not an earlier optimistic "sent".
  failed: 4,
};

/** Outbound: free-form text. Only legal inside the customer service window. */
export type OutboundTextMessage = {
  kind: "text";
  body: string;
};

/**
 * Outbound: a template Meta has already approved. The only thing that may be
 * sent once the customer service window has closed.
 */
export type OutboundTemplateMessage = {
  kind: "template";
  /** The provider-approved template name, not the friendly in-app name. */
  templateName: string;
  /** BCP-47-ish language code the template was approved in, e.g. "en" or "en_US". */
  language: string;
  /** Positional body parameters, in template order. */
  variables?: string[];
};

export type OutboundMessage = OutboundTextMessage | OutboundTemplateMessage;

export type SendReceipt = {
  channel: MetaChannel;
  /** Provider message id, used later to match delivery statuses. */
  providerMessageId: string;
  /** True when the send used an approved template rather than free-form text. */
  usedTemplate: boolean;
  /** The row written to `messages`, when the caller asked for one. */
  messageId: string | null;
};

/** Longest body we will hand to Meta. Their own limit for a text message. */
export const MAX_TEXT_LENGTH = 4096;
