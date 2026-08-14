/**
 * Server-side billing configuration.
 *
 * @vitest-environment node
 *
 * The node environment matters: `serverEnv()` refuses to run where `window`
 * exists, which is exactly the guard that keeps Stripe secrets out of the
 * browser bundle. Under the default jsdom environment every call would throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/stripe/prices` is server-only code. The marker package throws outside a
// React Server Component, so it is stubbed out; nothing of ours is mocked.
vi.mock("server-only", () => ({}));

import { __resetEnvCacheForTests } from "@/lib/env";
import { BILLING_INTERVALS, PLAN_KEYS } from "@/lib/plans";
import {
  billingConfigState,
  isPaidPlanKey,
  isPurchasable,
  planForPriceId,
  priceIdFor,
} from "@/lib/stripe/prices";

const PRICE_ENV = {
  STRIPE_STARTER_MONTHLY_PRICE_ID: "price_starter_month_abc",
  STRIPE_STARTER_ANNUAL_PRICE_ID: "price_starter_year_abc",
  STRIPE_GROWTH_MONTHLY_PRICE_ID: "price_growth_month_abc",
  STRIPE_GROWTH_ANNUAL_PRICE_ID: "price_growth_year_abc",
  STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro_month_abc",
  STRIPE_PRO_ANNUAL_PRICE_ID: "price_pro_year_abc",
} as const;

const ALL_STRIPE_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  ...Object.keys(PRICE_ENV),
] as const;

/** `serverEnv()` memoises, so the cache has to be dropped with every stub. */
function setEnv(values: Record<string, string | undefined>) {
  for (const name of ALL_STRIPE_VARS) {
    vi.stubEnv(name, values[name]);
  }
  __resetEnvCacheForTests();
}

function fullyConfigured(overrides: Record<string, string | undefined> = {}) {
  setEnv({
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
    ...PRICE_ENV,
    ...overrides,
  });
}

beforeEach(() => {
  fullyConfigured();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

describe("priceIdFor / planForPriceId", () => {
  it("round-trips every paid plan and interval", () => {
    const paidPlans = PLAN_KEYS.filter(isPaidPlanKey);
    expect(paidPlans).toEqual(["starter", "growth", "pro"]);

    const seen = new Set<string>();

    for (const plan of paidPlans) {
      for (const interval of BILLING_INTERVALS) {
        const priceId = priceIdFor(plan, interval);
        expect(priceId).toBe(`price_${plan}_${interval}_abc`);

        // Every price must be distinct, or the reverse lookup is ambiguous.
        expect(seen.has(priceId!)).toBe(false);
        seen.add(priceId!);

        expect(planForPriceId(priceId)).toEqual({ plan, interval });
      }
    }

    expect(seen.size).toBe(6);
  });

  it("returns null for a price id this deployment does not know", () => {
    expect(planForPriceId("price_someone_elses_product")).toBeNull();
    // Near-misses of a configured id must not match either.
    expect(planForPriceId("price_pro_month_ab")).toBeNull();
    expect(planForPriceId("PRICE_PRO_MONTH_ABC")).toBeNull();
    expect(planForPriceId(" price_pro_month_abc")).toBeNull();
  });

  it("returns null for empty, null and undefined price ids", () => {
    expect(planForPriceId("")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
    expect(planForPriceId(undefined)).toBeNull();
  });

  it("returns null for a plan whose price id is not configured", () => {
    fullyConfigured({ STRIPE_PRO_ANNUAL_PRICE_ID: undefined });

    expect(priceIdFor("pro", "year")).toBeNull();
    expect(priceIdFor("pro", "month")).toBe(
      PRICE_ENV.STRIPE_PRO_MONTHLY_PRICE_ID,
    );
    // The now-unconfigured price must stop resolving to a plan.
    expect(planForPriceId(PRICE_ENV.STRIPE_PRO_ANNUAL_PRICE_ID)).toBeNull();
  });

  it("treats a blank price id as unset rather than matching a blank input", () => {
    fullyConfigured({ STRIPE_GROWTH_ANNUAL_PRICE_ID: "   " });

    expect(priceIdFor("growth", "year")).toBeNull();
    expect(planForPriceId("")).toBeNull();
    expect(planForPriceId("   ")).toBeNull();
  });
});

describe("billingConfigState", () => {
  it("reports configured with no missing variables when everything is set", () => {
    expect(billingConfigState()).toEqual({ configured: true, missing: [] });
  });

  it("lists exactly the missing variables", () => {
    fullyConfigured({
      STRIPE_WEBHOOK_SECRET: undefined,
      STRIPE_GROWTH_MONTHLY_PRICE_ID: undefined,
    });

    expect(billingConfigState()).toEqual({
      configured: false,
      missing: ["STRIPE_WEBHOOK_SECRET", "STRIPE_GROWTH_MONTHLY_PRICE_ID"],
    });
  });

  it("lists every variable when nothing at all is configured", () => {
    setEnv({});

    expect(billingConfigState()).toEqual({
      configured: false,
      missing: [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_STARTER_MONTHLY_PRICE_ID",
        "STRIPE_GROWTH_MONTHLY_PRICE_ID",
        "STRIPE_PRO_MONTHLY_PRICE_ID",
      ],
    });
  });

  it("treats annual prices as optional", () => {
    fullyConfigured({
      STRIPE_STARTER_ANNUAL_PRICE_ID: undefined,
      STRIPE_GROWTH_ANNUAL_PRICE_ID: undefined,
      STRIPE_PRO_ANNUAL_PRICE_ID: undefined,
    });

    expect(billingConfigState()).toEqual({ configured: true, missing: [] });
  });
});

describe("isPurchasable", () => {
  it("is true only for paid plans with a configured price and a secret key", () => {
    expect(isPurchasable("starter", "month")).toBe(true);
    expect(isPurchasable("pro", "year")).toBe(true);
    // Free is the absence of a subscription, so it is never bought.
    expect(isPurchasable("free", "month")).toBe(false);
  });

  it("is false when the interval has no price id", () => {
    fullyConfigured({ STRIPE_STARTER_ANNUAL_PRICE_ID: undefined });

    expect(isPurchasable("starter", "year")).toBe(false);
    expect(isPurchasable("starter", "month")).toBe(true);
  });

  it("is false for every plan when the secret key is absent", () => {
    fullyConfigured({ STRIPE_SECRET_KEY: undefined });

    for (const plan of PLAN_KEYS) {
      for (const interval of BILLING_INTERVALS) {
        expect(isPurchasable(plan, interval)).toBe(false);
      }
    }
  });
});
