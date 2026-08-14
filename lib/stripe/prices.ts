import "server-only";

import { serverEnv } from "@/lib/env";
import {
  BILLING_INTERVALS,
  isPlanKey,
  type BillingInterval,
  type PlanKey,
} from "@/lib/plans";

/**
 * Mapping between our plan keys and the Stripe price ids configured for this
 * deployment.
 *
 * Price ids are account-specific, so they live in environment variables and are
 * never hardcoded. Free has no price: it is the absence of a subscription.
 */

type PaidPlanKey = Exclude<PlanKey, "free">;

const PRICE_ENV_KEYS: Record<
  PaidPlanKey,
  Record<BillingInterval, keyof ReturnType<typeof serverEnv>>
> = {
  starter: {
    month: "STRIPE_STARTER_MONTHLY_PRICE_ID",
    year: "STRIPE_STARTER_ANNUAL_PRICE_ID",
  },
  growth: {
    month: "STRIPE_GROWTH_MONTHLY_PRICE_ID",
    year: "STRIPE_GROWTH_ANNUAL_PRICE_ID",
  },
  pro: {
    month: "STRIPE_PRO_MONTHLY_PRICE_ID",
    year: "STRIPE_PRO_ANNUAL_PRICE_ID",
  },
};

export function isPaidPlanKey(value: unknown): value is PaidPlanKey {
  return isPlanKey(value) && value !== "free";
}

/** The configured Stripe price id, or null when it has not been set up. */
export function priceIdFor(
  plan: PaidPlanKey,
  interval: BillingInterval,
): string | null {
  return serverEnv()[PRICE_ENV_KEYS[plan][interval]] ?? null;
}

/**
 * Reverse lookup used by webhooks: Stripe tells us a price id, and we need to
 * know which plan the customer is now on. An unrecognised price maps to null
 * rather than guessing, so an unknown product can never silently grant Pro.
 */
export function planForPriceId(
  priceId: string | null | undefined,
): { plan: PaidPlanKey; interval: BillingInterval } | null {
  if (!priceId) return null;

  for (const plan of Object.keys(PRICE_ENV_KEYS) as PaidPlanKey[]) {
    for (const interval of BILLING_INTERVALS) {
      if (priceIdFor(plan, interval) === priceId) return { plan, interval };
    }
  }

  return null;
}

export type BillingConfigState = {
  configured: boolean;
  /** Plan/interval pairs that have no price id set. */
  missing: string[];
};

/**
 * Which paid plans are actually purchasable in this deployment. The billing
 * screen uses this to show an honest "Setup required" state rather than a
 * checkout button that would fail.
 */
export function billingConfigState(): BillingConfigState {
  const env = serverEnv();
  const missing: string[] = [];

  if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");

  for (const plan of Object.keys(PRICE_ENV_KEYS) as PaidPlanKey[]) {
    // Monthly is required; annual is optional.
    if (!priceIdFor(plan, "month")) {
      missing.push(PRICE_ENV_KEYS[plan].month);
    }
  }

  return { configured: missing.length === 0, missing };
}

/** True when a specific plan/interval can be checked out right now. */
export function isPurchasable(
  plan: PlanKey,
  interval: BillingInterval,
): boolean {
  if (!isPaidPlanKey(plan)) return false;
  if (!serverEnv().STRIPE_SECRET_KEY) return false;
  return priceIdFor(plan, interval) !== null;
}
