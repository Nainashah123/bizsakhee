import "server-only";

import type Stripe from "stripe";

import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * The Stripe customer that represents a workspace.
 *
 * One workspace has exactly one Stripe customer, and the link is stored on the
 * workspace's `subscriptions` row (which the database creates with every
 * workspace, see `20260813001100_workspace_defaults.sql`). That row is not
 * writable through RLS by design - a browser could otherwise point its
 * workspace at someone else's customer - so this takes a service-role client
 * and is only ever called after `requireCapability("billing.manage")` has
 * resolved the workspace id server-side.
 *
 * Idempotency has three layers:
 *   1. an existing `stripe_customer_id` short-circuits before any API call;
 *   2. the Stripe create call carries a workspace-derived idempotency key, so
 *      a retry inside Stripe's 24h window returns the same customer;
 *   3. the write back is conditional on the column still being null, so two
 *      concurrent checkouts converge on whichever customer landed first.
 */

/** Service-role Supabase client. Typed from the factory so the two cannot drift. */
type ServiceClient = ReturnType<typeof createAdminClient>;

export type WorkspaceCustomerInput = {
  workspaceId: string;
  /** Used as the Stripe customer name; never a source of authorisation. */
  workspaceName: string;
  /** The signed-in owner's email, so Stripe can send receipts. */
  email?: string | null;
};

/**
 * Stripe's idempotency keys are scoped per account and live for 24 hours. Keying
 * on the workspace means a double-clicked "Upgrade" cannot create two customers.
 */
export function customerIdempotencyKey(workspaceId: string): string {
  return `bizsakhi:workspace-customer:${workspaceId}`;
}

export async function findOrCreateStripeCustomer(
  deps: { stripe: Stripe; supabase: ServiceClient },
  input: WorkspaceCustomerInput,
): Promise<Result<string>> {
  const { stripe, supabase } = deps;
  const { workspaceId } = input;

  const existing = await readCustomerId(supabase, workspaceId);
  if (!existing.ok) return existing;
  if (existing.data.customerId) return ok(existing.data.customerId);

  if (!existing.data.rowExists) {
    // Defensive: every workspace should already have a subscriptions row, but a
    // workspace created before the trigger existed would not.
    const { error } = await supabase
      .from("subscriptions")
      .upsert(
        { workspace_id: workspaceId, plan: "free", status: "active" },
        { onConflict: "workspace_id", ignoreDuplicates: true },
      );

    if (error) {
      logger.error("stripe_customer_row_create_failed", {
        workspaceId,
        code: error.code,
      });
      return err(
        "upstream_error",
        "The billing record for this workspace could not be prepared.",
      );
    }
  }

  let customer: Stripe.Customer;
  try {
    customer = await stripe.customers.create(
      {
        name: input.workspaceName,
        ...(input.email ? { email: input.email } : {}),
        // Lets a human in the Stripe dashboard trace a customer back to a
        // workspace, and gives webhooks a second routing key.
        metadata: { workspace_id: workspaceId },
      },
      { idempotencyKey: customerIdempotencyKey(workspaceId) },
    );
  } catch (error) {
    // Stripe error messages can name the account and the request; log a type,
    // never the message, and hand the client a generic failure.
    logger.error("stripe_customer_create_failed", {
      workspaceId,
      type: stripeErrorType(error),
    });
    return err(
      "upstream_error",
      "Stripe could not be reached. Please try again in a moment.",
    );
  }

  // Conditional on the column still being null: whoever wrote first wins.
  const { data: claimed, error: claimError } = await supabase
    .from("subscriptions")
    .update({ stripe_customer_id: customer.id })
    .eq("workspace_id", workspaceId)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id");

  if (claimError) {
    logger.error("stripe_customer_link_failed", {
      workspaceId,
      code: claimError.code,
    });
    return err(
      "upstream_error",
      "The Stripe customer could not be linked to this workspace.",
    );
  }

  const linked = claimed?.[0]?.stripe_customer_id;
  if (linked) return ok(linked);

  // Zero rows updated: a concurrent request linked a customer first. Use theirs
  // so both requests bill the same customer.
  const reread = await readCustomerId(supabase, workspaceId);
  if (!reread.ok) return reread;
  if (reread.data.customerId) return ok(reread.data.customerId);

  logger.error("stripe_customer_link_lost", { workspaceId });
  return err(
    "upstream_error",
    "The Stripe customer could not be linked to this workspace.",
  );
}

/** The workspace's Stripe customer id, or null when it has never checked out. */
export async function getStripeCustomerId(
  supabase: ServiceClient,
  workspaceId: string,
): Promise<Result<string | null>> {
  const read = await readCustomerId(supabase, workspaceId);
  if (!read.ok) return read;
  return ok(read.data.customerId);
}

async function readCustomerId(
  supabase: ServiceClient,
  workspaceId: string,
): Promise<Result<{ rowExists: boolean; customerId: string | null }>> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("stripe_customer_read_failed", {
      workspaceId,
      code: error.code,
    });
    return err(
      "upstream_error",
      "The billing record for this workspace could not be read.",
    );
  }

  return ok({
    rowExists: Boolean(data),
    customerId: data?.stripe_customer_id ?? null,
  });
}

/** Stripe error `type` (e.g. "StripeAPIError") without the message body. */
function stripeErrorType(error: unknown): string {
  if (error && typeof error === "object" && "type" in error) {
    const type = (error as { type: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "unknown";
}
