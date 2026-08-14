import "server-only";

import { logger } from "@/lib/logger";
import {
  checkLimit,
  effectivePlan,
  formatLimit,
  getPlan,
  limitFor,
  nextPlanWithHigherLimit,
  usagePeriod,
  type CountedResource,
  type LimitKey,
  type MeteredMetric,
  type Plan,
  type PlanKey,
} from "@/lib/plans";
import { err, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import type { SubscriptionStatus } from "@/lib/supabase/database.types";

/**
 * Server-side entitlement enforcement.
 *
 * Nothing here trusts the browser: the plan comes from the `subscriptions` row
 * that Stripe webhooks write, the usage comes from the database, and both are
 * read with the caller's session so RLS applies on top of the explicit
 * `workspace_id` filter. The workspace id must already have been resolved
 * through `lib/auth` - it is never taken from a form field.
 *
 * Downgrades never delete anything. Being over a limit only blocks *creating*
 * more, which is why every failure message says so explicitly.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** `usage_counters.used` is an int4, so this is the largest cap we can pass. */
const UNLIMITED_CAP = 2_147_483_647;

/**
 * Read failures fail closed. Letting a transient database error hand out
 * unlimited records would be a quota bypass, and the write that would have
 * followed is very likely to fail anyway.
 */
const COUNT_FAILED_MESSAGE =
  "We could not check your plan limits just now. Please try again in a moment.";

const LIMIT_NOUNS: Record<LimitKey, { one: string; many: string }> = {
  contacts: { one: "customer", many: "customers" },
  products: { one: "product", many: "products" },
  seats: { one: "seat", many: "seats" },
  ai_generations: { one: "AI draft", many: "AI drafts this month" },
};

export type SubscriptionSnapshot = {
  /** The plan stored on the row, which is not always the plan in force. */
  storedPlan: PlanKey;
  status: SubscriptionStatus;
  interval: "month" | "year" | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  paymentFailedAt: string | null;
  /** Whether a portal session can be opened. The id itself stays server-side. */
  hasStripeCustomer: boolean;
};

export type UsageSnapshot = Record<LimitKey, number>;

export type WorkspaceEntitlements = {
  /** The plan actually in force right now, after status is taken into account. */
  plan: Plan;
  subscription: SubscriptionSnapshot | null;
  usage: UsageSnapshot;
  /** Calendar month key used for the metered counters. */
  period: string;
  /** True when at least one read failed, so the UI can say so instead of showing 0. */
  failed: boolean;
};

/** Human sentence for a limit that has been reached. Pure - safe to unit test. */
export function limitReachedMessage(
  planKey: unknown,
  limit: LimitKey,
  cap: number,
  upgradeTo: PlanKey | null,
): string {
  const plan = getPlan(planKey);
  const noun = LIMIT_NOUNS[limit];
  const used = `You have used all ${formatLimit(cap)} ${cap === 1 ? noun.one : noun.many} on the ${plan.name} plan.`;
  const kept =
    "Nothing has been deleted - everything you already have stays exactly where it is.";

  if (!upgradeTo) {
    return `${used} ${plan.name} is our largest plan, so please get in touch and we will sort out a fair-use arrangement. ${kept}`;
  }

  const next = getPlan(upgradeTo);
  const nextCap = formatLimit(next.limits[limit]);
  return `${used} Upgrade to ${next.name} for ${nextCap} ${noun.many}. ${kept}`;
}

/**
 * The pure decision: may this workspace create `additional` more of `limit`?
 *
 * Split out from the database reads so the rule itself can be tested without a
 * Supabase client, and so both the create paths and the billing screen agree.
 */
export function evaluateLimit(
  planKey: unknown,
  limit: LimitKey,
  current: number,
  additional = 1,
): Result<void> {
  const check = checkLimit(planKey, limit, current, additional);
  if (check.allowed) return ok(undefined);

  return err(
    "limit_reached",
    limitReachedMessage(planKey, limit, check.limit, check.upgradeTo),
  );
}

async function readSubscription(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<Result<SubscriptionSnapshot | null>> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "plan, status, interval, current_period_end, cancel_at_period_end, trial_ends_at, payment_failed_at, stripe_customer_id",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("subscription_read_failed", { code: error.code });
    return err("unknown", COUNT_FAILED_MESSAGE);
  }
  // No row at all is the normal state for a workspace that never paid.
  if (!data) return ok(null);

  return ok({
    storedPlan: data.plan,
    status: data.status,
    interval: data.interval,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    trialEndsAt: data.trial_ends_at,
    paymentFailedAt: data.payment_failed_at,
    hasStripeCustomer: Boolean(data.stripe_customer_id),
  });
}

/**
 * Count queries only - `head: true` means Postgres returns the number without
 * shipping a single row. Archived records are excluded so archiving is a real
 * way to make room without deleting anything.
 */
async function countResource(
  supabase: SupabaseServerClient,
  workspaceId: string,
  resource: CountedResource,
): Promise<Result<number>> {
  const { count, error } =
    resource === "seats"
      ? await supabase
          .from("workspace_members")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
      : resource === "contacts"
        ? await supabase
            .from("contacts")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .neq("status", "archived")
        : await supabase
            .from("products")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .neq("status", "archived");

  if (error) {
    logger.error("entitlement_count_failed", { resource, code: error.code });
    return err("unknown", COUNT_FAILED_MESSAGE);
  }

  return ok(count ?? 0);
}

async function readMeteredUsage(
  supabase: SupabaseServerClient,
  workspaceId: string,
  metric: MeteredMetric,
  period: string,
): Promise<Result<number>> {
  const { data, error } = await supabase
    .from("usage_counters")
    .select("used")
    .eq("workspace_id", workspaceId)
    .eq("metric", metric)
    .eq("period", period)
    .maybeSingle();

  if (error) {
    logger.error("usage_counter_read_failed", { metric, code: error.code });
    return err("unknown", COUNT_FAILED_MESSAGE);
  }

  return ok(data?.used ?? 0);
}

function isMetered(limit: LimitKey): limit is MeteredMetric {
  return limit === "ai_generations";
}

/** The plan in force, resolved from the stored subscription and its status. */
export async function getEffectivePlan(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<Result<{ plan: Plan; subscription: SubscriptionSnapshot | null }>> {
  const subscription = await readSubscription(supabase, workspaceId);
  if (!subscription.ok) return subscription;

  const plan = subscription.data
    ? effectivePlan({
        plan: subscription.data.storedPlan,
        status: subscription.data.status,
      })
    : getPlan("free");

  return ok({ plan, subscription: subscription.data });
}

/**
 * Everything the billing screen and the create paths need: the plan in force,
 * the subscription behind it, and the current usage for every limit.
 */
export async function getWorkspaceEntitlements(
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const supabase = await createClient();
  const period = usagePeriod();

  const [resolved, contacts, products, seats, aiGenerations] =
    await Promise.all([
      getEffectivePlan(supabase, workspaceId),
      countResource(supabase, workspaceId, "contacts"),
      countResource(supabase, workspaceId, "products"),
      countResource(supabase, workspaceId, "seats"),
      readMeteredUsage(supabase, workspaceId, "ai_generations", period),
    ]);

  const failed =
    !resolved.ok ||
    !contacts.ok ||
    !products.ok ||
    !seats.ok ||
    !aiGenerations.ok;

  return {
    plan: resolved.ok ? resolved.data.plan : getPlan("free"),
    subscription: resolved.ok ? resolved.data.subscription : null,
    usage: {
      contacts: contacts.ok ? contacts.data : 0,
      products: products.ok ? products.data : 0,
      seats: seats.ok ? seats.data : 0,
      ai_generations: aiGenerations.ok ? aiGenerations.data : 0,
    },
    period,
    failed,
  };
}

/**
 * Gate for a create path. Call this on the server before the insert - never
 * from a Client Component, and never with a plan or count sent by the browser.
 */
export async function assertWithinLimit(
  workspaceId: string,
  limit: LimitKey,
  additional = 1,
): Promise<Result<void>> {
  const supabase = await createClient();

  const resolved = await getEffectivePlan(supabase, workspaceId);
  if (!resolved.ok) return resolved;

  const current = isMetered(limit)
    ? await readMeteredUsage(supabase, workspaceId, limit, usagePeriod())
    : await countResource(supabase, workspaceId, limit);

  if (!current.ok) return current;

  return evaluateLimit(resolved.data.plan.key, limit, current.data, additional);
}

/**
 * Consumes metered quota atomically.
 *
 * The check and the increment happen inside `consume_usage`, so two concurrent
 * requests cannot both see "1 remaining" and both succeed. A NULL return means
 * the limit would have been exceeded and nothing was counted.
 */
export async function consumeMeteredUsage(
  workspaceId: string,
  metric: MeteredMetric,
  amount = 1,
): Promise<Result<{ used: number; limit: number | null }>> {
  const supabase = await createClient();

  const resolved = await getEffectivePlan(supabase, workspaceId);
  if (!resolved.ok) return resolved;

  const planKey = resolved.data.plan.key;
  const cap = limitFor(planKey, metric);

  const { data, error } = await supabase.rpc("consume_usage", {
    target_workspace: workspaceId,
    target_metric: metric,
    target_period: usagePeriod(),
    max_allowed: cap ?? UNLIMITED_CAP,
    amount,
  });

  if (error) {
    logger.error("consume_usage_failed", { metric, code: error.code });
    return err(
      "unknown",
      "We could not record that usage. Please try again in a moment.",
    );
  }

  // NULL means the increment was refused because it would cross the cap.
  if (data === null || data === undefined) {
    return err(
      "limit_reached",
      limitReachedMessage(
        planKey,
        metric,
        cap ?? UNLIMITED_CAP,
        nextPlanWithHigherLimit(planKey, metric),
      ),
    );
  }

  return ok({ used: data, limit: cap });
}
