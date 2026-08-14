import "server-only";

import { logger } from "@/lib/logger";
import {
  effectivePlan,
  formatLimit,
  getPlan,
  limitFor,
  nextPlanWithHigherLimit,
  usagePeriod,
  type Limit,
  type PlanKey,
} from "@/lib/plans";
import { err, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

/**
 * Monthly AI quota.
 *
 * The check and the increment are one statement inside the `consume_usage`
 * function, so two requests arriving together cannot both see "1 left" and both
 * go through. A NULL return means the increment was refused and nothing was
 * counted.
 *
 * The unit is consumed *before* the model is called, because that is the only
 * order that is safe: consuming afterwards would let a workspace fire twenty
 * concurrent requests against a cap of one.
 *
 * WHAT HAPPENS TO THE UNIT WHEN THE GENERATION THEN FAILS
 * -------------------------------------------------------
 * It stays consumed. That is deliberate, not an oversight:
 *
 *   - `consume_usage` refuses a non-positive `amount`, so there is no atomic
 *     "give it back" path. A plain UPDATE ... used = used - 1 races with any
 *     concurrent consumer and can drive the counter below the real usage.
 *   - A refund on failure is a quota bypass whenever failures are cheap to
 *     provoke: a caller that can make the provider time out could generate
 *     without limit.
 *
 * Every attempt - successful or not - is written to `ai_generations` with
 * `succeeded` and `error_code`, so a genuinely broken run can be identified and
 * credited by a human. Provider outages should be rare; silently uncapped usage
 * should be rarer.
 */

const METRIC = "ai_generations" as const;

/** `usage_counters.used` is an int4, so this is the largest cap we can pass. */
const UNLIMITED_CAP = 2_147_483_647;

const READ_FAILED =
  "We could not check your AI allowance just now. Please try again in a moment.";

export type AiQuota = {
  plan: PlanKey;
  /** Drafts used this calendar month, after this call. */
  used: number;
  /** The plan's cap, or null for "no hard cap". */
  limit: Limit;
  /** Drafts left, or null when there is no cap. Never negative. */
  remaining: number | null;
  /** First day of the current month, UTC, e.g. "2026-08-01". */
  period: string;
};

/** The integer cap handed to SQL. `null` (no cap) becomes the int4 ceiling. */
export function effectiveCap(limit: Limit): number {
  return limit === null ? UNLIMITED_CAP : limit;
}

export function remainingFor(limit: Limit, used: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - used);
}

/**
 * The sentence shown when the month's allowance is gone.
 *
 * Names the plan the seller is on, the cap she hit, and the cheapest plan that
 * would actually raise it - a generic "upgrade!" tells her nothing.
 */
export function aiLimitReachedMessage(
  planKey: unknown,
  cap: number,
  upgradeTo: PlanKey | null,
): string {
  const plan = getPlan(planKey);
  const used = `You have used all ${formatLimit(cap)} AI drafts on the ${plan.name} plan this month.`;
  const resets = "Your allowance resets on the 1st.";

  if (!upgradeTo) {
    return `${used} ${plan.name} is our largest plan, so please get in touch and we will sort out a fair-use arrangement. ${resets}`;
  }

  const next = getPlan(upgradeTo);
  return `${used} Upgrade to ${next.name} for ${formatLimit(next.limits.ai_generations)} drafts a month. ${resets}`;
}

/**
 * The pure decision, split out from the database call so the rule can be tested
 * without a Supabase client.
 *
 * `consumed` is exactly what `consume_usage` returned: the new count, or null
 * when the increment would have crossed the cap.
 */
export function decideAiQuota({
  plan,
  limit,
  consumed,
  period,
}: {
  plan: PlanKey;
  limit: Limit;
  consumed: number | null;
  period: string;
}): Result<AiQuota> {
  if (consumed === null) {
    return err(
      "limit_reached",
      aiLimitReachedMessage(
        plan,
        effectiveCap(limit),
        nextPlanWithHigherLimit(plan, METRIC),
      ),
    );
  }

  return ok({
    plan,
    used: consumed,
    limit,
    remaining: remainingFor(limit, consumed),
    period,
  });
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The plan actually in force. Read from the `subscriptions` row that the Stripe
 * webhooks write - never from anything the browser sent. No row at all is the
 * normal state for a workspace that has never paid, and means Free.
 *
 * Fails closed: a read error refuses the generation rather than handing out an
 * unmetered draft.
 */
async function readPlanKey(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<Result<PlanKey>> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("ai_quota_subscription_read_failed", { code: error.code });
    return err("unknown", READ_FAILED);
  }

  if (!data) return ok("free");
  return ok(effectivePlan({ plan: data.plan, status: data.status }).key);
}

/**
 * Consumes one AI draft from this month's allowance.
 *
 * Call this on the server, before the model, and only for a live provider - the
 * mock provider costs nothing and must not eat a seller's paid allowance in CI
 * or in a local run.
 */
export async function consumeAiGeneration(
  workspaceId: string,
): Promise<Result<AiQuota>> {
  const supabase = await createClient();

  const plan = await readPlanKey(supabase, workspaceId);
  if (!plan.ok) return plan;

  const limit = limitFor(plan.data, METRIC);
  const period = usagePeriod();

  const { data, error } = await supabase.rpc("consume_usage", {
    target_workspace: workspaceId,
    target_metric: METRIC,
    target_period: period,
    max_allowed: effectiveCap(limit),
    amount: 1,
  });

  if (error) {
    logger.error("ai_quota_consume_failed", { code: error.code });
    return err("unknown", READ_FAILED);
  }

  return decideAiQuota({
    plan: plan.data,
    limit,
    consumed: data ?? null,
    period,
  });
}

export type AiQuotaSnapshot = AiQuota & {
  /** True when a read failed, so the UI can say so instead of showing zero. */
  failed: boolean;
};

/**
 * This month's usage, for display only. Never used to decide whether a
 * generation may run - `consume_usage` is the authority on that.
 */
export async function readAiQuota(
  workspaceId: string,
): Promise<AiQuotaSnapshot> {
  const supabase = await createClient();
  const period = usagePeriod();

  const [plan, counter] = await Promise.all([
    readPlanKey(supabase, workspaceId),
    supabase
      .from("usage_counters")
      .select("used")
      .eq("workspace_id", workspaceId)
      .eq("metric", METRIC)
      .eq("period", period)
      .maybeSingle(),
  ]);

  if (counter.error) {
    logger.error("ai_quota_counter_read_failed", { code: counter.error.code });
  }

  const planKey = plan.ok ? plan.data : "free";
  const limit = limitFor(planKey, METRIC);
  const used = counter.data?.used ?? 0;

  return {
    plan: planKey,
    used,
    limit,
    remaining: remainingFor(limit, used),
    period,
    failed: !plan.ok || Boolean(counter.error),
  };
}
