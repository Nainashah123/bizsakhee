import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/auth/session";
import { absoluteUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { httpStatusFor, type ErrorCode } from "@/lib/result";
import { getStripe } from "@/lib/stripe/client";
import { billingConfigState } from "@/lib/stripe/prices";
import { createClient } from "@/lib/supabase/server";

/**
 * Open the Stripe billing portal so an owner can change card, download invoices
 * or cancel.
 *
 * POST /api/stripe/portal
 *   request  {} (no body is read)
 *   response 200 { "url": "https://billing.stripe.com/..." }
 *
 * A workspace that has never checked out has no Stripe customer, and Stripe has
 * nothing to show it. That is a 409 with an explicit message rather than a
 * portal link that would 500 - the UI should offer "choose a plan" instead.
 *
 * The read uses the session client: `subscriptions` is readable by members
 * under RLS, so nothing here needs the service-role key.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST() {
  const authorised = await requireCapability("billing.manage");
  if (!authorised.ok) {
    return fail(authorised.error.code, authorised.error.message);
  }
  const { workspace } = authorised.data;

  const config = billingConfigState();
  const stripe = getStripe();
  if (!config.configured || !stripe) {
    return fail(
      "not_configured",
      "Billing is not set up for this deployment yet, so the billing portal is unavailable.",
      { missing: config.missing },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (error) {
    logger.error("stripe_portal_read_failed", {
      workspaceId: workspace.id,
      code: error.code,
    });
    return fail(
      "upstream_error",
      "The billing record for this workspace could not be read.",
    );
  }

  const customerId = data?.stripe_customer_id ?? null;
  if (!customerId) {
    return fail(
      "conflict",
      "This workspace has no Stripe customer yet. Choose a plan first, then the billing portal becomes available.",
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: absoluteUrl("/dashboard/billing"),
    });

    if (!session.url) {
      logger.error("stripe_portal_no_url", { workspaceId: workspace.id });
      return fail(
        "upstream_error",
        "Stripe did not return a billing portal link. Please try again.",
      );
    }

    logger.info("stripe_portal_created", { workspaceId: workspace.id });

    return NextResponse.json(
      { url: session.url },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (caught) {
    // The commonest cause is a Stripe account whose customer portal has never
    // been configured. Say so without echoing Stripe's message.
    logger.error("stripe_portal_failed", {
      workspaceId: workspace.id,
      type:
        caught && typeof caught === "object" && "type" in caught
          ? String((caught as { type: unknown }).type)
          : "unknown",
    });
    return fail(
      "upstream_error",
      "The billing portal could not be opened. If this keeps happening, the Stripe customer portal may not be configured yet.",
    );
  }
}
