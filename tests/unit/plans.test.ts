import { describe, expect, it } from "vitest";

import {
  checkLimit,
  effectivePlan,
  formatLimit,
  getPlan,
  isPlanKey,
  limitFor,
  nextPlanWithHigherLimit,
  ORDERED_PLANS,
  planHasFeature,
  PLAN_KEYS,
  PLANS,
  usagePeriod,
  type LimitKey,
  type PlanKey,
} from "@/lib/plans";

/**
 * The published plan table. If a limit changes here it has to change on the
 * pricing page, in the database and in the customer's expectations - so this
 * test is deliberately a duplicate of the numbers we advertise.
 */
const PUBLISHED: Record<
  PlanKey,
  { seats: number; contacts: number; products: number | null; ai: number }
> = {
  free: { seats: 1, contacts: 50, products: 10, ai: 20 },
  starter: { seats: 1, contacts: 500, products: 100, ai: 200 },
  growth: { seats: 3, contacts: 5000, products: 500, ai: 1000 },
  pro: { seats: 10, contacts: 25000, products: null, ai: 5000 },
};

describe("plan definitions", () => {
  it("matches the published limits exactly", () => {
    for (const key of PLAN_KEYS) {
      const expected = PUBLISHED[key];
      expect(PLANS[key].limits.seats, `${key} seats`).toBe(expected.seats);
      expect(PLANS[key].limits.contacts, `${key} contacts`).toBe(
        expected.contacts,
      );
      expect(PLANS[key].limits.products, `${key} products`).toBe(
        expected.products,
      );
      expect(PLANS[key].limits.ai_generations, `${key} AI`).toBe(expected.ai);
    }
  });

  it("prices the plans at ₹0, ₹299, ₹699 and ₹1,499 a month in paise", () => {
    expect(PLANS.free.monthlyPriceMinor).toBe(0);
    expect(PLANS.starter.monthlyPriceMinor).toBe(29_900);
    expect(PLANS.growth.monthlyPriceMinor).toBe(69_900);
    expect(PLANS.pro.monthlyPriceMinor).toBe(149_900);

    // Every price is a whole number of paise - never a float.
    for (const plan of ORDERED_PLANS) {
      expect(Number.isInteger(plan.monthlyPriceMinor)).toBe(true);
      expect(Number.isInteger(plan.annualPriceMinor)).toBe(true);
      expect(plan.currency).toBe("INR");
    }
  });

  it("orders the plans cheapest first and never lowers a limit on a dearer plan", () => {
    expect(ORDERED_PLANS.map((plan) => plan.key)).toEqual([
      "free",
      "starter",
      "growth",
      "pro",
    ]);

    const limits: LimitKey[] = [
      "seats",
      "contacts",
      "products",
      "ai_generations",
    ];
    for (const limit of limits) {
      for (let index = 1; index < ORDERED_PLANS.length; index += 1) {
        const previous = ORDERED_PLANS[index - 1].limits[limit];
        const current = ORDERED_PLANS[index].limits[limit];
        if (current === null) continue; // unlimited is never a reduction
        expect(previous, `${limit} on ${ORDERED_PLANS[index].key}`).not.toBe(
          null,
        );
        expect(current).toBeGreaterThanOrEqual(previous as number);
      }
    }
  });

  it("only gives paid plans the paid features", () => {
    expect(planHasFeature("free", "automations")).toBe(false);
    expect(planHasFeature("starter", "automations")).toBe(false);
    expect(planHasFeature("growth", "automations")).toBe(true);
    expect(planHasFeature("growth", "priority_support")).toBe(false);
    expect(planHasFeature("pro", "priority_support")).toBe(true);
  });
});

describe("getPlan", () => {
  it("falls back to Free for anything that is not a plan key", () => {
    for (const garbage of [
      undefined,
      null,
      "",
      "PRO",
      "enterprise",
      42,
      { key: "pro" },
      ["pro"],
    ]) {
      expect(getPlan(garbage).key, String(garbage)).toBe("free");
    }
  });

  it("returns the plan itself for a valid key", () => {
    expect(getPlan("growth").key).toBe("growth");
    expect(isPlanKey("growth")).toBe(true);
    expect(isPlanKey("Growth")).toBe(false);
  });

  it("resolves limits through the same fallback", () => {
    expect(limitFor("enterprise", "contacts")).toBe(50);
    expect(limitFor("pro", "products")).toBeNull();
  });
});

describe("checkLimit", () => {
  it("permits the 50th contact and refuses the 51st on Free", () => {
    const fiftieth = checkLimit("free", "contacts", 49);
    expect(fiftieth.allowed).toBe(true);
    expect(fiftieth.allowed && fiftieth.remaining).toBe(0);

    const fiftyFirst = checkLimit("free", "contacts", 50);
    expect(fiftyFirst.allowed).toBe(false);
    expect(fiftyFirst.allowed === false && fiftyFirst.limit).toBe(50);
    expect(fiftyFirst.allowed === false && fiftyFirst.current).toBe(50);
    expect(fiftyFirst.allowed === false && fiftyFirst.upgradeTo).toBe(
      "starter",
    );
  });

  it("treats a null limit as always allowed, however large the count", () => {
    const check = checkLimit("pro", "products", 10_000_000, 5_000);
    expect(check.allowed).toBe(true);
    expect(check.allowed && check.remaining).toBeNull();
  });

  it("refuses a batch that would cross the cap but allows one that lands on it", () => {
    expect(checkLimit("free", "contacts", 40, 10).allowed).toBe(true);
    expect(checkLimit("free", "contacts", 40, 11).allowed).toBe(false);
  });

  it("keeps refusing while a downgraded workspace is over the cap", () => {
    const check = checkLimit("free", "contacts", 4_000);
    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.current).toBe(4_000);
    expect(check.allowed === false && check.limit).toBe(50);
  });

  it("ignores a negative or fractional current count instead of trusting it", () => {
    expect(checkLimit("free", "contacts", -100).allowed).toBe(true);
    const check = checkLimit("free", "contacts", 50.9);
    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.current).toBe(50);
  });
});

describe("nextPlanWithHigherLimit", () => {
  it("names the cheapest plan that actually raises the limit", () => {
    expect(nextPlanWithHigherLimit("free", "contacts")).toBe("starter");
    expect(nextPlanWithHigherLimit("free", "products")).toBe("starter");
    // Starter has the same single seat as Free, so it is not the answer.
    expect(PLANS.starter.limits.seats).toBe(PLANS.free.limits.seats);
    expect(nextPlanWithHigherLimit("free", "seats")).toBe("growth");
  });

  it("treats an unlimited plan as a higher limit", () => {
    expect(nextPlanWithHigherLimit("growth", "products")).toBe("pro");
  });

  it("returns null on Pro, which has nothing above it", () => {
    expect(nextPlanWithHigherLimit("pro", "contacts")).toBeNull();
    expect(nextPlanWithHigherLimit("pro", "seats")).toBeNull();
    expect(nextPlanWithHigherLimit("pro", "products")).toBeNull();
    expect(nextPlanWithHigherLimit("pro", "ai_generations")).toBeNull();
  });

  it("falls back to the Free ladder for an unknown plan key", () => {
    expect(nextPlanWithHigherLimit("enterprise", "contacts")).toBe("starter");
  });
});

describe("effectivePlan", () => {
  it("keeps the paid plan while Stripe still considers it live", () => {
    expect(effectivePlan({ plan: "growth", status: "active" }).key).toBe(
      "growth",
    );
    expect(effectivePlan({ plan: "growth", status: "trialing" }).key).toBe(
      "growth",
    );
    // A failed card is retried, not an instant lockout.
    expect(effectivePlan({ plan: "growth", status: "past_due" }).key).toBe(
      "growth",
    );
  });

  it("drops to Free once the subscription is cancelled or unpaid", () => {
    expect(effectivePlan({ plan: "pro", status: "canceled" }).key).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "unpaid" }).key).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "incomplete" }).key).toBe(
      "free",
    );
    expect(effectivePlan({ plan: "pro", status: "paused" }).key).toBe("free");
  });

  it("never promotes a missing or unknown plan to a paid one", () => {
    expect(effectivePlan({ status: "active" }).key).toBe("free");
    expect(effectivePlan({ plan: "enterprise", status: "active" }).key).toBe(
      "free",
    );
    expect(effectivePlan({ plan: null, status: null }).key).toBe("free");
  });
});

describe("formatLimit and usagePeriod", () => {
  it("says Unlimited rather than showing an empty value", () => {
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(25_000)).toBe("25,000");
  });

  it("keys usage on the first day of the UTC month", () => {
    expect(usagePeriod(new Date("2026-08-14T22:30:00Z"))).toBe("2026-08-01");
    expect(usagePeriod(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01-01");
    // A local-time month boundary must not shift the period key.
    expect(usagePeriod(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03-01");
  });
});
