import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/session";
import { absoluteUrl, serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { BILLING_INTERVALS } from "@/lib/plans";
import { httpStatusFor, type ErrorCode } from "@/lib/result";
import { getStripe } from "@/lib/stripe/client";
import { findOrCreateStripeCustomer } from "@/lib/stripe/customer";
import {
  billingConfigState,
  isPurchasable,
  priceIdFor,
} from "@/lib/stripe/prices";
import { createAdminClient } from "@/lib/supabase/server";
import { fieldErrorsFrom } from "@/lib/validation/form";

/**
 * Start a Stripe Checkout session for a plan upgrade.
 *
 * POST /api/stripe/checkout
 *   request  { "plan": "starter" | "growth" | "pro", "interval": "month" | "year" }
 *   response 200 { "url": "https://checkout.stripe.com/..." }
 *
 * The workspace is never taken from the request: `requireCapability` resolves it
 * from the session and asserts the caller is an owner. The body carries nothing
 * but a plan and an interval, and the price the customer is charged comes from
 * the Stripe price id configured on the server - never from the browser.
 *
 * `success_url` is a courtesy redirect, not proof of anything. Entitlement is
 * granted only when the subscription webhooks arrive.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  plan: z.enum(["starter", "growth", "pro"]),
  interval: z.enum(BILLING_INTERVALS),
});

function fail(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: code, message, ...extra },
    { status: httpStatusFor(code), headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("validation", "Send a JSON body with a plan and an interval.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation", "That plan or billing period is not valid.", {
      fieldErrors: fieldErrorsFrom(parsed.error),
    });
  }
  const { plan, interval } = parsed.data;

  const authorised = await requireCapability("billing.manage");
  if (!authorised.ok) {
    return fail(authorised.error.code, authorised.error.message);
  }
  const { user, workspace } = authorised.data;

  const config = billingConfigState();
  if (!config.configured) {
    return fail(
      "not_configured",
      "Billing is not set up for this deployment yet, so plans cannot be purchased.",
      { missing: config.missing },
    );
  }

  if (!isPurchasable(plan, interval)) {
    return fail(
      "not_configured",
      "That billing period is not available for this plan yet.",
    );
  }

  const priceId = priceIdFor(plan, interval);
  const stripe = getStripe();
  if (!priceId || !stripe) {
    return fail("not_configured", "Billing is not set up for this deployment.");
  }

  if (!serverEnv().SUPABASE_SECRET_KEY) {
    // The subscription row is not writable through RLS on purpose, so linking a
    // Stripe customer needs the service-role key.
    return fail(
      "not_configured",
      "Billing is not fully set up for this deployment yet.",
      { missing: ["SUPABASE_SECRET_KEY"] },
    );
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return fail("not_configured", "Billing is not set up for this deployment.");
  }

  const customer = await findOrCreateStripeCustomer(
    { stripe, supabase },
    {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      email: user.email ?? null,
    },
  );
  if (!customer.ok) {
    return fail(customer.error.code, customer.error.message);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.data,
      line_items: [{ price: priceId, quantity: 1 }],
      // Three references, because each is read by a different code path:
      // client_reference_id shows up in the Stripe dashboard, session metadata
      // is read by checkout.session.completed, and subscription_data.metadata
      // is what customer.subscription.* events carry.
      client_reference_id: workspace.id,
      metadata: { workspace_id: workspace.id, plan, interval },
      subscription_data: {
        metadata: { workspace_id: workspace.id, plan, interval },
      },
      // `checkout=complete` deliberately does not say "paid": the billing page
      // shows the plan the webhooks have actually confirmed.
      success_url: absoluteUrl(
        "/dashboard/billing?checkout=complete&session_id={CHECKOUT_SESSION_ID}",
      ),
      cancel_url: absoluteUrl("/dashboard/billing?checkout=cancelled"),
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    if (!session.url) {
      logger.error("stripe_checkout_no_url", { workspaceId: workspace.id });
      return fail(
        "upstream_error",
        "Stripe did not return a checkout link. Please try again.",
      );
    }

    logger.info("stripe_checkout_created", {
      workspaceId: workspace.id,
      plan,
      interval,
    });

    return NextResponse.json(
      { url: session.url },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Stripe messages can name the account and the request id; keep them out of
    // the response and out of the log line's public surface.
    logger.error("stripe_checkout_failed", {
      workspaceId: workspace.id,
      plan,
      interval,
      type:
        error && typeof error === "object" && "type" in error
          ? String((error as { type: unknown }).type)
          : "unknown",
    });
    return fail(
      "upstream_error",
      "Stripe could not start the checkout. Please try again in a moment.",
    );
  }
}
