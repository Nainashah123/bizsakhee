import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Monthly AI quota.
 *
 * The rule itself is pure, so most of this file needs no test doubles at all.
 * The only thing mocked is the Supabase client - an external service boundary.
 * `consume_usage` and `limitFor` are our own logic and are exercised for real.
 */

// `lib/ai/quota` is server-only code; the marker package throws outside a React
// Server Component, so it is stubbed out.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  type SubscriptionRow = { plan: string; status: string } | null;

  const state = {
    subscription: { data: null as SubscriptionRow, error: null as unknown },
    counter: { data: null as { used: number } | null, error: null as unknown },
    rpc: vi.fn(),
  };

  return state;
});

vi.mock("@/lib/supabase/server", () => {
  // A chainable stub: `.select().eq().eq().eq().maybeSingle()` must work for
  // any number of `.eq()` calls, so `eq` returns the same node.
  const node = (result: unknown) => {
    const self = {
      eq: () => self,
      maybeSingle: async () => result,
    };
    return self;
  };

  return {
    createClient: async () => ({
      from: (table: string) => ({
        select: () =>
          node(table === "subscriptions" ? mocks.subscription : mocks.counter),
      }),
      rpc: mocks.rpc,
    }),
  };
});

import {
  aiLimitReachedMessage,
  consumeAiGeneration,
  decideAiQuota,
  effectiveCap,
  readAiQuota,
  remainingFor,
} from "@/lib/ai/quota";

const WORKSPACE = "3f1c0c9e-6a3d-4d21-8f0a-2a6b7c8d9e01";
const PERIOD = "2026-08-01";

beforeEach(() => {
  mocks.subscription = { data: null, error: null };
  mocks.counter = { data: null, error: null };
  mocks.rpc = vi.fn();
});

// ---------------------------------------------------------------------------
// The pure decision
// ---------------------------------------------------------------------------

describe("decideAiQuota", () => {
  it("passes when the month still has room", () => {
    const result = decideAiQuota({
      plan: "free",
      limit: 20,
      consumed: 7,
      period: PERIOD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      plan: "free",
      used: 7,
      limit: 20,
      remaining: 13,
      period: PERIOD,
    });
  });

  it("passes on the very last draft, leaving nothing remaining", () => {
    const result = decideAiQuota({
      plan: "free",
      limit: 20,
      consumed: 20,
      period: PERIOD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.remaining).toBe(0);
  });

  it("refuses an exhausted month and names the cheapest plan that raises the cap", () => {
    const result = decideAiQuota({
      plan: "free",
      limit: 20,
      consumed: null,
      period: PERIOD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("limit_reached");
    expect(result.error.message).toContain("Free");
    expect(result.error.message).toContain("20");
    // Starter is the next plan that actually raises ai_generations (20 -> 200).
    expect(result.error.message).toContain("Starter");
    expect(result.error.message).toContain("200");
  });

  it("names Growth, not Starter, for a workspace already on Starter", () => {
    const result = decideAiQuota({
      plan: "starter",
      limit: 200,
      consumed: null,
      period: PERIOD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Growth");
    expect(result.error.message).not.toContain("Upgrade to Starter");
  });

  it("does not invent an upgrade for the largest plan", () => {
    const result = decideAiQuota({
      plan: "pro",
      limit: 5_000,
      consumed: null,
      period: PERIOD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("largest plan");
    expect(result.error.message).not.toContain("Upgrade to");
  });

  it("never blocks a plan with no hard cap", () => {
    const result = decideAiQuota({
      plan: "pro",
      limit: null,
      consumed: 9_999_999,
      period: PERIOD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.remaining).toBeNull();
    expect(result.data.limit).toBeNull();
  });
});

describe("effectiveCap and remainingFor", () => {
  it("turns 'no cap' into the largest value the int4 counter can hold", () => {
    // Anything larger overflows `usage_counters.used` and the RPC would error
    // rather than allow the call.
    expect(effectiveCap(null)).toBe(2_147_483_647);
    expect(effectiveCap(20)).toBe(20);
  });

  it("never reports negative headroom for a workspace that is over its cap", () => {
    expect(remainingFor(20, 25)).toBe(0);
    expect(remainingFor(null, 25)).toBeNull();
  });
});

describe("aiLimitReachedMessage", () => {
  it("says nothing about deletion and points at the reset date", () => {
    const message = aiLimitReachedMessage("free", 20, "starter");
    expect(message).toContain("resets on the 1st");
  });
});

// ---------------------------------------------------------------------------
// Against a mocked Supabase boundary
// ---------------------------------------------------------------------------

describe("consumeAiGeneration", () => {
  it("charges a workspace with no subscription row against the Free cap", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_usage", {
      target_workspace: WORKSPACE,
      target_metric: "ai_generations",
      target_period: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      max_allowed: 20,
      amount: 1,
    });
  });

  it("uses the paid cap for an active subscription", async () => {
    mocks.subscription = {
      data: { plan: "growth", status: "active" },
      error: null,
    };
    mocks.rpc.mockResolvedValue({ data: 501, error: null });

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      plan: "growth",
      used: 501,
      limit: 1_000,
      remaining: 499,
    });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ max_allowed: 1_000 });
  });

  it("falls back to the Free cap when the subscription is no longer entitling", async () => {
    mocks.subscription = {
      data: { plan: "pro", status: "canceled" },
      error: null,
    };
    mocks.rpc.mockResolvedValue({ data: 3, error: null });

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.plan).toBe("free");
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ max_allowed: 20 });
  });

  it("still entitles a past_due subscription rather than locking her out mid-retry", async () => {
    mocks.subscription = {
      data: { plan: "starter", status: "past_due" },
      error: null,
    };
    mocks.rpc.mockResolvedValue({ data: 10, error: null });

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.plan).toBe("starter");
  });

  it("returns limit_reached when the RPC refuses the increment", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("limit_reached");
    expect(result.error.message).toContain("Starter");
  });

  it("fails closed - and not as limit_reached - when the plan cannot be read", async () => {
    mocks.subscription = { data: null, error: { code: "PGRST301" } };

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown");
    // Nothing was charged, because the RPC was never reached.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not report a database error as an exhausted quota", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });

    const result = await consumeAiGeneration(WORKSPACE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown");
  });
});

describe("readAiQuota", () => {
  it("reports zero used for a month with no counter row yet", async () => {
    const snapshot = await readAiQuota(WORKSPACE);

    expect(snapshot).toMatchObject({
      plan: "free",
      used: 0,
      limit: 20,
      remaining: 20,
      failed: false,
    });
    // Display only: reading the meter must never consume a draft.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("flags a failed read instead of quietly showing zero", async () => {
    mocks.counter = { data: null, error: { code: "PGRST301" } };

    const snapshot = await readAiQuota(WORKSPACE);

    expect(snapshot.failed).toBe(true);
  });
});
