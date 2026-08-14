import { z } from "zod";

import { logger } from "@/lib/logger";
import type { BillingInterval, PlanKey } from "@/lib/plans";
import { err, ok, type Result } from "@/lib/result";
import { planForPriceId } from "@/lib/stripe/prices";
import type {
  SubscriptionRow,
  SubscriptionStatus,
} from "@/lib/supabase/database.types";
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * Stripe webhook event -> subscription state.
 *
 * `subscriptionStateFromEvent` is a pure function: event in, decision out. It
 * touches no network, no database and no clock (every timestamp is derived from
 * `event.created`), which is what makes the entitlement rules testable.
 * `applySubscriptionState` is the only part that writes.
 *
 * Two rules matter more than the rest:
 *
 *   1. Webhook state is the *only* source of truth for what a workspace is
 *      entitled to. A success redirect proves nothing; a checkout can complete
 *      and the payment still fail.
 *   2. A price id we do not recognise never grants a paid plan. `planForPriceId`
 *      returns null for anything not in the configured environment, and we fall
 *      back to Free with a warning rather than guessing.
 *
 * Payloads are parsed with Zod because a webhook is an untrusted boundary even
 * after the signature checks out - the shape of an object varies by API version.
 * Nothing here logs a payload, an email or any other customer data.
 */

export const HANDLED_STRIPE_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export type HandledStripeEventType =
  (typeof HANDLED_STRIPE_EVENT_TYPES)[number];

export function isHandledStripeEventType(
  type: string,
): type is HandledStripeEventType {
  return (HANDLED_STRIPE_EVENT_TYPES as readonly string[]).includes(type);
}

/** The subset of the `subscriptions` row a webhook is allowed to write. */
export type SubscriptionPatch = Partial<
  Pick<
    SubscriptionRow,
    | "plan"
    | "status"
    | "stripe_customer_id"
    | "stripe_subscription_id"
    | "stripe_price_id"
    | "interval"
    | "current_period_end"
    | "cancel_at_period_end"
    | "payment_failed_at"
  >
>;

export const WEBHOOK_WARNINGS = [
  /** Stripe named a price this deployment does not know: fell back to Free. */
  "unrecognised_price",
  /** The subscription carried no price at all: fell back to Free. */
  "missing_price",
  /** Stripe sent a status outside our enum: treated as non-entitling. */
  "unknown_subscription_status",
] as const;

export type WebhookWarning = (typeof WEBHOOK_WARNINGS)[number];

export type WebhookOutcome =
  /** Not one of ours, or not subscription-related. Acknowledge and move on. */
  | { kind: "ignored"; eventType: string; reason: string }
  /** Ours, but unusable. Acknowledge: a retry would deliver the same bytes. */
  | { kind: "unprocessable"; eventType: string; reason: string }
  | {
      kind: "apply";
      eventType: HandledStripeEventType;
      /** Primary routing key. */
      customerId: string | null;
      /** Fallback routing key, from session/subscription metadata. */
      workspaceId: string | null;
      patch: SubscriptionPatch;
      warnings: WebhookWarning[];
    };

/** The shape of a Stripe event this module needs. `Stripe.Event` satisfies it. */
export type StripeEventInput = {
  id: string;
  type: string;
  /** Seconds since the epoch. The only clock this module uses. */
  created: number;
  data: { object: unknown };
};

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

/** Stripe sends either an id or the expanded object. Both carry the id. */
const referenceSchema = z.union([z.string(), z.object({ id: z.string() })]);

const metadataSchema = z.record(z.string(), z.unknown()).nullish();

const checkoutSessionSchema = z.object({
  mode: z.string().nullish(),
  customer: referenceSchema.nullish(),
  subscription: referenceSchema.nullish(),
  client_reference_id: z.string().nullish(),
  metadata: metadataSchema,
});

const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer: referenceSchema.nullish(),
  cancel_at_period_end: z.boolean().nullish(),
  /**
   * Removed from the subscription in the 2025-03-31 API version and moved onto
   * each item. Read both so a webhook sent under an older account version still
   * yields a period end rather than silently null.
   */
  current_period_end: z.number().nullish(),
  metadata: metadataSchema,
  items: z
    .object({
      data: z.array(
        z.object({
          current_period_end: z.number().nullish(),
          price: z.object({ id: z.string().nullish() }).nullish(),
        }),
      ),
    })
    .nullish(),
});

const invoiceSchema = z.object({
  customer: referenceSchema.nullish(),
  billing_reason: z.string().nullish(),
  /** Pre-2025 shape. */
  subscription: referenceSchema.nullish(),
  parent: z
    .object({
      type: z.string().nullish(),
      subscription_details: z
        .object({
          subscription: referenceSchema.nullish(),
          metadata: metadataSchema,
        })
        .nullish(),
    })
    .nullish(),
});

// ---------------------------------------------------------------------------
// The pure mapping
// ---------------------------------------------------------------------------

export function subscriptionStateFromEvent(
  event: StripeEventInput,
): WebhookOutcome {
  if (!isHandledStripeEventType(event.type)) {
    return {
      kind: "ignored",
      eventType: event.type,
      reason: "unhandled_event_type",
    };
  }

  switch (event.type) {
    case "checkout.session.completed":
      return fromCheckoutSession(event);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return fromSubscription(event, event.type);
    case "customer.subscription.deleted":
      return fromSubscriptionDeleted(event);
    case "invoice.paid":
      return fromInvoice(event, "paid");
    case "invoice.payment_failed":
      return fromInvoice(event, "failed");
  }
}

function fromCheckoutSession(event: StripeEventInput): WebhookOutcome {
  const parsed = checkoutSessionSchema.safeParse(event.data.object);
  if (!parsed.success) {
    return unprocessable(event.type, "malformed_checkout_session");
  }

  const session = parsed.data;
  if (session.mode && session.mode !== "subscription") {
    return {
      kind: "ignored",
      eventType: event.type,
      reason: "non_subscription_checkout",
    };
  }

  const customerId = referenceId(session.customer);
  const workspaceId =
    workspaceIdFrom(session.metadata) ??
    asWorkspaceId(session.client_reference_id);

  /**
   * Deliberately no plan and no status. A completed session means Stripe took
   * the customer through checkout, not that money moved - the subscription
   * events that follow carry the authoritative status. All this does is link
   * the workspace to its Stripe ids so those events can be routed.
   */
  const patch: SubscriptionPatch = {};
  if (customerId) patch.stripe_customer_id = customerId;

  const subscriptionId = referenceId(session.subscription);
  if (subscriptionId) patch.stripe_subscription_id = subscriptionId;

  return route(
    "checkout.session.completed",
    customerId,
    workspaceId,
    patch,
    [],
  );
}

function fromSubscription(
  event: StripeEventInput,
  eventType: HandledStripeEventType,
): WebhookOutcome {
  const parsed = subscriptionSchema.safeParse(event.data.object);
  if (!parsed.success) {
    return unprocessable(eventType, "malformed_subscription");
  }

  const subscription = parsed.data;
  const warnings: WebhookWarning[] = [];

  const priceId = subscription.items?.data[0]?.price?.id ?? null;
  const mapped = planForPriceId(priceId);

  let plan: PlanKey = "free";
  let interval: BillingInterval | null = null;

  if (mapped) {
    plan = mapped.plan;
    interval = mapped.interval;
  } else if (priceId) {
    // An unknown price must never grant a paid plan - a mis-set environment
    // variable would otherwise hand out Pro for free, or for the wrong money.
    warnings.push("unrecognised_price");
  } else {
    warnings.push("missing_price");
  }

  const status = toSubscriptionStatus(subscription.status);
  if (!status) warnings.push("unknown_subscription_status");

  const patch: SubscriptionPatch = {
    plan,
    // An unrecognised status is treated as `incomplete`, which does not entitle.
    status: status ?? "incomplete",
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    interval,
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
  };

  const customerId = referenceId(subscription.customer);
  if (customerId) patch.stripe_customer_id = customerId;

  // A subscription that is healthy again clears a stale payment failure, so the
  // "update your card" banner disappears without waiting for the next invoice.
  if (status === "active" || status === "trialing") {
    patch.payment_failed_at = null;
  }

  return route(
    eventType,
    customerId,
    workspaceIdFrom(subscription.metadata),
    patch,
    warnings,
  );
}

function fromSubscriptionDeleted(event: StripeEventInput): WebhookOutcome {
  const parsed = subscriptionSchema.safeParse(event.data.object);
  if (!parsed.success) {
    return unprocessable(event.type, "malformed_subscription");
  }

  const subscription = parsed.data;

  const patch: SubscriptionPatch = {
    plan: "free",
    status: "canceled",
    stripe_price_id: null,
    interval: null,
    cancel_at_period_end: false,
    // Keep the last period end so the UI can say when access actually ended.
    current_period_end: periodEnd(subscription),
    payment_failed_at: null,
    // Cleared rather than kept: the subscription no longer exists, and the
    // column is UNIQUE, so a stale id would block the next subscription.
    stripe_subscription_id: null,
  };

  const customerId = referenceId(subscription.customer);
  // The customer survives cancellation, so the link is kept for the next upgrade.
  if (customerId) patch.stripe_customer_id = customerId;

  return route(
    "customer.subscription.deleted",
    customerId,
    workspaceIdFrom(subscription.metadata),
    patch,
    [],
  );
}

function fromInvoice(
  event: StripeEventInput,
  result: "paid" | "failed",
): WebhookOutcome {
  const eventType: HandledStripeEventType =
    result === "paid" ? "invoice.paid" : "invoice.payment_failed";

  const parsed = invoiceSchema.safeParse(event.data.object);
  if (!parsed.success) return unprocessable(eventType, "malformed_invoice");

  const invoice = parsed.data;
  const details = invoice.parent?.subscription_details ?? null;
  const subscriptionId =
    referenceId(details?.subscription) ?? referenceId(invoice.subscription);

  if (!subscriptionId) {
    // A one-off invoice says nothing about a subscription's entitlement.
    return {
      kind: "ignored",
      eventType,
      reason: "non_subscription_invoice",
    };
  }

  const patch: SubscriptionPatch =
    result === "paid"
      ? { payment_failed_at: null }
      : {
          payment_failed_at: isoFromUnixSeconds(event.created),
          /**
           * A failed *renewal* means the card stopped working on a subscription
           * the customer already has: `past_due` keeps them in (Stripe is still
           * retrying) while the UI prompts for a new card. A failed *first*
           * payment is different - that subscription is `incomplete` and was
           * never entitling, so writing `past_due` here would hand out a paid
           * plan nobody paid for. In that case only the flag is set and the
           * subscription events remain the authority on status.
           */
          ...(invoice.billing_reason === "subscription_create"
            ? {}
            : { status: "past_due" as const }),
        };

  const customerId = referenceId(invoice.customer);
  if (customerId) patch.stripe_customer_id = customerId;

  return route(
    eventType,
    customerId,
    workspaceIdFrom(details?.metadata),
    patch,
    [],
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function route(
  eventType: HandledStripeEventType,
  customerId: string | null,
  workspaceId: string | null,
  patch: SubscriptionPatch,
  warnings: WebhookWarning[],
): WebhookOutcome {
  if (!customerId && !workspaceId) {
    // Nothing to route on. Retrying delivers the same payload, so acknowledge.
    return unprocessable(eventType, "no_workspace_reference");
  }
  return { kind: "apply", eventType, customerId, workspaceId, patch, warnings };
}

function unprocessable(eventType: string, reason: string): WebhookOutcome {
  return { kind: "unprocessable", eventType, reason };
}

function referenceId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Metadata is attacker-influenced text; only a real UUID is allowed through. */
function workspaceIdFrom(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  return asWorkspaceId(metadata?.workspace_id);
}

function asWorkspaceId(value: unknown): string | null {
  return z.uuid().safeParse(value).success ? (value as string) : null;
}

function periodEnd(subscription: {
  current_period_end?: number | null;
  items?: { data: Array<{ current_period_end?: number | null }> } | null;
}): string | null {
  const fromItem = subscription.items?.data[0]?.current_period_end;
  const seconds = fromItem ?? subscription.current_period_end ?? null;
  return seconds === null ? null : isoFromUnixSeconds(seconds);
}

function isoFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
];

export function toSubscriptionStatus(value: string): SubscriptionStatus | null {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriptionStatus)
    : null;
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createAdminClient>;

/**
 * Applies an `apply` outcome to the workspace's subscription row.
 *
 * Routing prefers `stripe_customer_id`, which is written the first time a
 * workspace checks out, and falls back to the workspace id carried in event
 * metadata for the very first event of a workspace's life. A `not_found` result
 * is final; `upstream_error` means the caller should let Stripe retry.
 */
export async function applySubscriptionState(
  supabase: ServiceClient,
  outcome: Extract<WebhookOutcome, { kind: "apply" }>,
): Promise<Result<{ workspaceId: string }>> {
  let workspaceId: string | null = null;

  if (outcome.customerId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("workspace_id")
      .eq("stripe_customer_id", outcome.customerId)
      .maybeSingle();

    if (error) {
      logger.error("stripe_webhook_lookup_failed", {
        eventType: outcome.eventType,
        code: error.code,
      });
      return err("upstream_error", "Subscription lookup failed.");
    }

    workspaceId = data?.workspace_id ?? null;
  }

  workspaceId ??= outcome.workspaceId;

  if (!workspaceId) {
    return err("not_found", "No workspace matches this Stripe customer.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("subscriptions")
    .update(outcome.patch)
    .eq("workspace_id", workspaceId)
    .select("workspace_id");

  if (updateError) {
    logger.error("stripe_webhook_update_failed", {
      eventType: outcome.eventType,
      code: updateError.code,
    });
    return err("upstream_error", "Subscription update failed.");
  }

  if (!updated?.length) {
    // The workspace was deleted between the checkout and this event.
    return err("not_found", "No subscription row for this workspace.");
  }

  return ok({ workspaceId });
}
