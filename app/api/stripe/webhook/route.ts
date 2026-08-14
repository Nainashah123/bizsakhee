import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getStripe } from "@/lib/stripe/client";
import {
  applySubscriptionState,
  subscriptionStateFromEvent,
} from "@/lib/stripe/webhook-handlers";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Stripe webhook endpoint.
 *
 * POST /api/stripe/webhook
 *   request  the raw Stripe event body, signed with `stripe-signature`
 *   response 200 { "received": true, ... } for anything we will not retry
 *
 * This is the only place a workspace's plan and subscription status are ever
 * granted. A checkout redirect proves nothing; this does.
 *
 * Shape of the handler, in order, because the order is the correctness:
 *
 *   1. Read the RAW body. `request.text()` - never `request.json()` - because
 *      the signature covers the exact bytes Stripe sent.
 *   2. Verify the signature. A failure is a 400 and a log line with no payload.
 *   3. INSERT the event id into `webhook_events` before doing any work. The
 *      unique index on (source, external_event_id) is what makes replay a
 *      no-op: a 23505 means we have seen this event, so return 200 and stop.
 *   4. Map the event to subscription state and write it.
 *   5. Mark the row processed or failed.
 *
 * Step 3 has one consequence worth spelling out. Because a duplicate delivery
 * short-circuits at the insert, a 5xx would be pointless if the marker row
 * survived - Stripe's retry would arrive, hit 23505, and skip the work forever.
 * So on a genuinely retryable failure the marker is deleted before returning
 * 500. Everything that a retry cannot fix (bad payload, unknown workspace,
 * event type we do not handle) is acknowledged with 200 and recorded.
 *
 * Nothing here logs a payload, an email, a card or a customer name.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNIQUE_VIOLATION = "23505";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = serverEnv().STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    logger.warn("stripe_webhook_not_configured");
    return json(
      {
        error: "not_configured",
        message:
          "Stripe is not configured for this deployment, so webhooks cannot be verified.",
      },
      503,
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    logger.warn("stripe_webhook_missing_signature");
    return json({ error: "bad_request", message: "Missing signature." }, 400);
  }

  // Raw bytes, exactly as sent. Parsing first would break verification.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    // No payload, no signature, no reason string: only that verification failed.
    logger.warn("stripe_webhook_signature_invalid");
    return json({ error: "bad_request", message: "Invalid signature." }, 400);
  }

  if (!serverEnv().SUPABASE_SECRET_KEY) {
    logger.error("stripe_webhook_missing_service_role", {
      eventId: event.id,
      eventType: event.type,
    });
    // Retrying after the key is configured genuinely helps, so let Stripe retry.
    return json(
      {
        error: "not_configured",
        message:
          "SUPABASE_SECRET_KEY is not set, so subscription state cannot be written.",
      },
      503,
    );
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    logger.error("stripe_webhook_client_failed", { eventId: event.id });
    return json(
      {
        error: "not_configured",
        message: "The service-role Supabase client could not be created.",
      },
      503,
    );
  }

  // --- Idempotency claim -------------------------------------------------
  const { error: claimError } = await supabase.from("webhook_events").insert({
    source: "stripe",
    external_event_id: event.id,
    event_type: event.type,
    status: "received",
  });

  if (claimError) {
    if (claimError.code === UNIQUE_VIOLATION) {
      logger.info("stripe_webhook_duplicate", {
        eventId: event.id,
        eventType: event.type,
      });
      return json({ received: true, duplicate: true }, 200);
    }

    logger.error("stripe_webhook_claim_failed", {
      eventId: event.id,
      eventType: event.type,
      code: claimError.code,
    });
    return json(
      { error: "upstream_error", message: "Event could not be recorded." },
      500,
    );
  }

  // --- Decide -------------------------------------------------------------
  const outcome = subscriptionStateFromEvent(event);

  if (outcome.kind === "ignored") {
    await finish(supabase, event.id, "processed", null, null);
    logger.info("stripe_webhook_ignored", {
      eventId: event.id,
      eventType: event.type,
      reason: outcome.reason,
    });
    return json(
      { received: true, handled: false, reason: outcome.reason },
      200,
    );
  }

  if (outcome.kind === "unprocessable") {
    await finish(supabase, event.id, "failed", null, outcome.reason);
    logger.warn("stripe_webhook_unprocessable", {
      eventId: event.id,
      eventType: event.type,
      reason: outcome.reason,
    });
    // A retry would deliver the same bytes, so acknowledge rather than loop.
    return json(
      { received: true, handled: false, reason: outcome.reason },
      200,
    );
  }

  if (outcome.warnings.length > 0) {
    logger.warn("stripe_webhook_warnings", {
      eventId: event.id,
      eventType: event.type,
      warnings: outcome.warnings,
    });
  }

  // --- Write --------------------------------------------------------------
  const applied = await applySubscriptionState(supabase, outcome);

  if (!applied.ok) {
    if (applied.error.code === "not_found") {
      await finish(supabase, event.id, "failed", null, "workspace_not_found");
      logger.warn("stripe_webhook_workspace_not_found", {
        eventId: event.id,
        eventType: event.type,
      });
      return json(
        { received: true, handled: false, reason: "workspace_not_found" },
        200,
      );
    }

    // Database trouble: a retry can genuinely succeed. Release the idempotency
    // claim first, or the retry would be swallowed as a duplicate.
    const { error: releaseError } = await supabase
      .from("webhook_events")
      .delete()
      .eq("source", "stripe")
      .eq("external_event_id", event.id);

    if (releaseError) {
      // Could not release: leave a failed marker for a human to look at.
      await finish(supabase, event.id, "failed", null, "apply_failed");
      logger.error("stripe_webhook_release_failed", {
        eventId: event.id,
        eventType: event.type,
        code: releaseError.code,
      });
    }

    logger.error("stripe_webhook_apply_failed", {
      eventId: event.id,
      eventType: event.type,
    });
    return json(
      {
        error: "upstream_error",
        message: "Subscription state could not be written.",
      },
      500,
    );
  }

  await finish(supabase, event.id, "processed", applied.data.workspaceId, null);

  logger.info("stripe_webhook_processed", {
    eventId: event.id,
    eventType: event.type,
    workspaceId: applied.data.workspaceId,
  });

  return json({ received: true, handled: true }, 200);
}

/** Best-effort close-out of the idempotency row. Never fails the request. */
async function finish(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
  status: "processed" | "failed",
  workspaceId: string | null,
  reason: string | null,
) {
  const { error } = await supabase
    .from("webhook_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      workspace_id: workspaceId,
      // A short machine-readable reason only: never a payload or a Stripe message.
      error_message: reason,
    })
    .eq("source", "stripe")
    .eq("external_event_id", eventId);

  if (error) {
    logger.error("stripe_webhook_finalise_failed", {
      eventId,
      code: error.code,
    });
  }
}
