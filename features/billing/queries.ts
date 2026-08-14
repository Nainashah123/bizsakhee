import "server-only";

import {
  getWorkspaceEntitlements,
  type SubscriptionSnapshot,
} from "@/lib/plans/entitlements";
import {
  nextPlanWithHigherLimit,
  type Limit,
  type LimitKey,
  type Plan,
  type PlanKey,
} from "@/lib/plans";

/**
 * Reads for the billing screen.
 *
 * The plan in force, the subscription behind it, the current record counts and
 * this month's AI usage. Counts come from `head: true` count queries, so no
 * rows are shipped just to be counted.
 */

export type UsageMeter = {
  key: LimitKey;
  label: string;
  used: number;
  limit: Limit;
  /** Bar width, clamped to 0-100 so an over-limit workspace never overflows. */
  percent: number;
  /** True when the workspace is already at or past the cap. */
  atLimit: boolean;
  /** The cheapest plan that actually raises this limit, if any. */
  upgradeTo: PlanKey | null;
  helper: string;
};

export type BillingOverview = {
  /** The plan actually in force, not necessarily the plan on the row. */
  plan: Plan;
  subscription: SubscriptionSnapshot | null;
  meters: UsageMeter[];
  /** Meters that are at or over their cap, for the "you cannot add more" note. */
  blocked: UsageMeter[];
  /** Calendar month the metered counters belong to, e.g. "2026-08-01". */
  period: string;
  /** True when a read failed. The page shows an error state rather than zeros. */
  failed: boolean;
};

const METER_COPY: Record<LimitKey, { label: string; helper: string }> = {
  contacts: {
    label: "Customers",
    helper: "Archived customers do not count towards your plan.",
  },
  products: {
    label: "Products",
    helper: "Archived products do not count towards your plan.",
  },
  seats: {
    label: "Team seats",
    helper: "People who can sign in to this workspace.",
  },
  ai_generations: {
    label: "AI drafts",
    helper: "Resets on the 1st of every month.",
  },
};

/** Clamped so a workspace that is over its cap still shows a full bar, not 140%. */
export function meterPercent(used: number, limit: Limit): number {
  if (limit === null || limit <= 0) return 0;
  const safeUsed = Math.max(0, used);
  return Math.min(100, Math.round((safeUsed / limit) * 100));
}

function buildMeter(key: LimitKey, used: number, plan: Plan): UsageMeter {
  const limit = plan.limits[key];
  return {
    key,
    label: METER_COPY[key].label,
    helper: METER_COPY[key].helper,
    used,
    limit,
    percent: meterPercent(used, limit),
    atLimit: limit !== null && used >= limit,
    upgradeTo: nextPlanWithHigherLimit(plan.key, key),
  };
}

export async function getBillingOverview(
  workspaceId: string,
): Promise<BillingOverview> {
  const entitlements = await getWorkspaceEntitlements(workspaceId);
  const { plan, usage } = entitlements;

  const meters: UsageMeter[] = [
    buildMeter("contacts", usage.contacts, plan),
    buildMeter("products", usage.products, plan),
    buildMeter("seats", usage.seats, plan),
    buildMeter("ai_generations", usage.ai_generations, plan),
  ];

  return {
    plan,
    subscription: entitlements.subscription,
    meters,
    blocked: meters.filter((meter) => meter.atLimit),
    period: entitlements.period,
    failed: entitlements.failed,
  };
}
