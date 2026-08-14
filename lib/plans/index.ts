/**
 * Plan definitions and entitlements.
 *
 * This is the single source of truth for what a workspace may do. It is
 * imported by server code only — never trust a plan, limit or price sent by
 * the browser. Stripe price ids live in environment variables because they are
 * account-specific and must not be committed.
 *
 * Prices here are for display. What a customer is actually charged is whatever
 * the Stripe price says; these numbers must be kept in step with the prices
 * created in the Stripe dashboard.
 */

export const PLAN_KEYS = ["free", "starter", "growth", "pro"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Metered features counted per calendar month in `usage_counters`. */
export const METERED_METRICS = ["ai_generations"] as const;
export type MeteredMetric = (typeof METERED_METRICS)[number];

/** Resources capped by total row count rather than per month. */
export const COUNTED_RESOURCES = ["contacts", "products", "seats"] as const;
export type CountedResource = (typeof COUNTED_RESOURCES)[number];

export type LimitKey = MeteredMetric | CountedResource;

/**
 * `null` means "no hard cap" (fair use). It is deliberately not `Infinity` so
 * the value survives JSON round-trips intact.
 */
export type Limit = number | null;

export type PlanLimits = Record<LimitKey, Limit>;

export type PlanFeature =
  | "automations"
  | "channel_integrations"
  | "priority_support";

export type Plan = {
  key: PlanKey;
  name: string;
  /** One line shown on the pricing page and the billing screen. */
  tagline: string;
  /** Display price in minor units (paise) for the monthly interval. */
  monthlyPriceMinor: number;
  /** Display price in minor units for the annual interval, per year. */
  annualPriceMinor: number;
  currency: "INR";
  limits: PlanLimits;
  features: readonly PlanFeature[];
  /** Highlights shown as a bullet list. */
  highlights: readonly string[];
};

const FREE: Plan = {
  key: "free",
  name: "Free",
  tagline: "Get organised with your first customers.",
  monthlyPriceMinor: 0,
  annualPriceMinor: 0,
  currency: "INR",
  limits: {
    seats: 1,
    contacts: 50,
    products: 10,
    ai_generations: 20,
  },
  features: [],
  highlights: [
    "1 seat",
    "50 customers",
    "10 products",
    "20 AI drafts a month",
    "Orders, payments and follow-ups",
  ],
};

const STARTER: Plan = {
  key: "starter",
  name: "Starter",
  tagline: "For a business that is past its first handful of orders.",
  monthlyPriceMinor: 29900,
  annualPriceMinor: 299000,
  currency: "INR",
  limits: {
    seats: 1,
    contacts: 500,
    products: 100,
    ai_generations: 200,
  },
  features: [],
  highlights: [
    "1 seat",
    "500 customers",
    "100 products",
    "200 AI drafts a month",
  ],
};

const GROWTH: Plan = {
  key: "growth",
  name: "Growth",
  tagline: "For a small team selling every day.",
  monthlyPriceMinor: 69900,
  annualPriceMinor: 699000,
  currency: "INR",
  limits: {
    seats: 3,
    contacts: 5_000,
    products: 500,
    ai_generations: 1_000,
  },
  features: ["automations", "channel_integrations"],
  highlights: [
    "3 seats",
    "5,000 customers",
    "500 products",
    "1,000 AI drafts a month",
    "Automations and channel integrations",
  ],
};

const PRO: Plan = {
  key: "pro",
  name: "Pro",
  tagline: "For an established brand with a team behind it.",
  monthlyPriceMinor: 149900,
  annualPriceMinor: 1499000,
  currency: "INR",
  limits: {
    seats: 10,
    contacts: 25_000,
    // Unlimited under fair use.
    products: null,
    ai_generations: 5_000,
  },
  features: ["automations", "channel_integrations", "priority_support"],
  highlights: [
    "10 seats",
    "25,000 customers",
    "Unlimited products (fair use)",
    "5,000 AI drafts a month",
    "Priority support",
  ],
};

export const PLANS: Record<PlanKey, Plan> = {
  free: FREE,
  starter: STARTER,
  growth: GROWTH,
  pro: PRO,
};

/** Cheapest first. Used for the pricing page and upgrade suggestions. */
export const ORDERED_PLANS: readonly Plan[] = [FREE, STARTER, GROWTH, PRO];

export function isPlanKey(value: unknown): value is PlanKey {
  return (
    typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value)
  );
}

/** Unknown or missing plan keys fall back to Free — never to a paid plan. */
export function getPlan(key: unknown): Plan {
  return isPlanKey(key) ? PLANS[key] : FREE;
}

export function limitFor(planKey: unknown, limit: LimitKey): Limit {
  return getPlan(planKey).limits[limit];
}

export function planHasFeature(planKey: unknown, feature: PlanFeature): boolean {
  return getPlan(planKey).features.includes(feature);
}

export type LimitCheck =
  | { allowed: true; remaining: Limit }
  | { allowed: false; limit: number; current: number; upgradeTo: PlanKey | null };

/**
 * Whether one more of `limit` may be created.
 *
 * `current` is the count that already exists. Adding `additional` items is
 * allowed only when the total stays at or below the cap, so a limit of 50 means
 * the 51st is refused.
 */
export function checkLimit(
  planKey: unknown,
  limit: LimitKey,
  current: number,
  additional = 1,
): LimitCheck {
  const cap = limitFor(planKey, limit);

  if (cap === null) return { allowed: true, remaining: null };

  const safeCurrent = Math.max(0, Math.trunc(current));
  if (safeCurrent + additional <= cap) {
    return { allowed: true, remaining: cap - safeCurrent - additional };
  }

  return {
    allowed: false,
    limit: cap,
    current: safeCurrent,
    upgradeTo: nextPlanWithHigherLimit(planKey, limit),
  };
}

/**
 * The cheapest plan above the current one that actually raises this limit, or
 * null when the customer is already on the most generous plan. Used to make
 * upgrade prompts specific rather than a generic "upgrade!".
 */
export function nextPlanWithHigherLimit(
  planKey: unknown,
  limit: LimitKey,
): PlanKey | null {
  const current = getPlan(planKey);
  const currentCap = current.limits[limit];
  const startIndex = ORDERED_PLANS.findIndex((plan) => plan.key === current.key);

  for (const plan of ORDERED_PLANS.slice(startIndex + 1)) {
    const cap = plan.limits[limit];
    if (cap === null) return plan.key;
    if (currentCap !== null && cap > currentCap) return plan.key;
  }

  return null;
}

/** First day of the month, in UTC, used as the usage-counter period key. */
export function usagePeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function formatLimit(limit: Limit): string {
  if (limit === null) return "Unlimited";
  return new Intl.NumberFormat("en-IN").format(limit);
}

/**
 * Subscription statuses that entitle a workspace to its paid plan.
 *
 * `past_due` deliberately still counts: the customer's card failed but Stripe
 * is retrying, and locking them out of their own data mid-retry is a dark
 * pattern. Access ends when the subscription is actually cancelled or unpaid.
 */
export const ENTITLING_STATUSES = ["active", "trialing", "past_due"] as const;

export function isEntitlingStatus(status: string | null | undefined): boolean {
  return (ENTITLING_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * The plan a workspace is actually entitled to right now. A cancelled or
 * unpaid subscription falls back to Free regardless of the stored plan key.
 */
export function effectivePlan(subscription: {
  plan?: string | null;
  status?: string | null;
}): Plan {
  if (!isEntitlingStatus(subscription.status)) return FREE;
  return getPlan(subscription.plan);
}
