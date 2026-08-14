import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component graph. It is a build
// guard, not behaviour, so it is stubbed away here.
vi.mock("server-only", () => ({}));

// The Supabase client is the only boundary that is faked. Every decision below
// is made by our own code.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import {
  assertWithinLimit,
  consumeMeteredUsage,
  evaluateLimit,
  getWorkspaceEntitlements,
  limitReachedMessage,
} from "@/lib/plans/entitlements";
import { usagePeriod } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type QueryOutcome = {
  data?: unknown;
  count?: number | null;
  error?: { code: string } | null;
};

const WORKSPACE = "3f1d6b0a-4b6c-4f4a-9c5d-0a1b2c3d4e5f";

/** A minimal PostgREST-shaped builder: chainable, awaitable, maybeSingle-able. */
function chain(outcome: QueryOutcome) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    maybeSingle: () => Promise.resolve(outcome),
    then: (
      resolve: (value: QueryOutcome) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(outcome).then(resolve, reject),
  };
  return builder;
}

type FakeConfig = {
  subscription?: QueryOutcome;
  contacts?: QueryOutcome;
  products?: QueryOutcome;
  seats?: QueryOutcome;
  usage?: QueryOutcome;
  rpc?: { data: number | null; error: { code: string } | null };
};

function fakeSupabase(config: FakeConfig = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  const outcomes: Record<string, QueryOutcome> = {
    subscriptions: config.subscription ?? { data: null, error: null },
    contacts: config.contacts ?? { count: 0, error: null },
    products: config.products ?? { count: 0, error: null },
    workspace_members: config.seats ?? { count: 1, error: null },
    usage_counters: config.usage ?? { data: null, error: null },
  };

  const client = {
    from: (table: string) =>
      chain(outcomes[table] ?? { data: null, error: null }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(config.rpc ?? { data: 1, error: null });
    },
  };

  vi.mocked(createClient).mockResolvedValue(
    client as unknown as SupabaseServerClient,
  );

  return { rpcCalls };
}

function subscriptionRow(
  plan: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    data: {
      plan,
      status,
      interval: "month",
      current_period_end: "2026-09-14T00:00:00Z",
      cancel_at_period_end: false,
      trial_ends_at: null,
      payment_failed_at: null,
      stripe_customer_id: "cus_test",
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evaluateLimit", () => {
  it("passes while there is room left", () => {
    expect(evaluateLimit("free", "contacts", 0).ok).toBe(true);
    expect(evaluateLimit("free", "contacts", 49).ok).toBe(true);
  });

  it("blocks exactly at the limit and names the plan that raises it", () => {
    const result = evaluateLimit("free", "contacts", 50);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("limit_reached");
    expect(result.error.message).toContain("50");
    expect(result.error.message).toContain("Free");
    expect(result.error.message).toContain("Starter");
    expect(result.error.message).toContain("500");
    // Downgrades never delete: the message has to say so.
    expect(result.error.message).toMatch(/nothing has been deleted/i);
  });

  it("keeps blocking a workspace that is over the limit after a downgrade", () => {
    const result = evaluateLimit("free", "contacts", 4_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("limit_reached");
  });

  it("never blocks an unlimited limit", () => {
    expect(evaluateLimit("pro", "products", 0).ok).toBe(true);
    expect(evaluateLimit("pro", "products", 5_000_000).ok).toBe(true);
    expect(evaluateLimit("pro", "products", 5_000_000, 1_000).ok).toBe(true);
  });

  it("blocks a batch that would cross the limit, and allows one that fits", () => {
    expect(evaluateLimit("free", "contacts", 45, 5).ok).toBe(true);
    expect(evaluateLimit("free", "contacts", 45, 6).ok).toBe(false);
  });

  it("suggests the plan that actually raises the limit, not merely the next one", () => {
    // Starter has the same single seat as Free, so Growth is the honest answer.
    const result = evaluateLimit("free", "seats", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Growth");
    expect(result.error.message).not.toContain("Starter");
  });

  it("does not promise an upgrade that does not exist on the top plan", () => {
    const result = evaluateLimit("pro", "contacts", 25_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toMatch(/upgrade to/i);
    expect(result.error.message).toMatch(/largest plan/i);
  });

  it("treats an unknown plan key as Free rather than as a paid plan", () => {
    expect(evaluateLimit("enterprise", "contacts", 50).ok).toBe(false);
    expect(evaluateLimit("enterprise", "contacts", 10).ok).toBe(true);
  });
});

describe("limitReachedMessage", () => {
  it("uses the singular noun for a one-item limit", () => {
    expect(limitReachedMessage("free", "seats", 1, "growth")).toContain(
      "1 seat on the Free plan",
    );
  });
});

describe("assertWithinLimit", () => {
  it("allows a create when the workspace is under the Free limit", async () => {
    fakeSupabase({ contacts: { count: 49, error: null } });
    const result = await assertWithinLimit(WORKSPACE, "contacts");
    expect(result.ok).toBe(true);
  });

  it("blocks the 51st contact on Free and names Starter", async () => {
    fakeSupabase({ contacts: { count: 50, error: null } });
    const result = await assertWithinLimit(WORKSPACE, "contacts");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("limit_reached");
    expect(result.error.message).toContain("Starter");
  });

  it("uses the paid limit while the subscription is live", async () => {
    fakeSupabase({
      subscription: subscriptionRow("growth", "active"),
      contacts: { count: 4_999, error: null },
    });
    expect((await assertWithinLimit(WORKSPACE, "contacts")).ok).toBe(true);

    fakeSupabase({
      subscription: subscriptionRow("growth", "active"),
      contacts: { count: 5_000, error: null },
    });
    const blocked = await assertWithinLimit(WORKSPACE, "contacts");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.message).toContain("Pro");
  });

  it("keeps the plan for a past-due subscription rather than locking the customer out", async () => {
    fakeSupabase({
      subscription: subscriptionRow("growth", "past_due"),
      contacts: { count: 1_200, error: null },
    });
    expect((await assertWithinLimit(WORKSPACE, "contacts")).ok).toBe(true);
  });

  it("falls back to the Free limit once the subscription is cancelled", async () => {
    fakeSupabase({
      subscription: subscriptionRow("pro", "canceled"),
      contacts: { count: 60, error: null },
    });
    const result = await assertWithinLimit(WORKSPACE, "contacts");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("limit_reached");
    expect(result.error.message).toContain("Free");
  });

  it("checks metered limits against the usage counter, not a row count", async () => {
    fakeSupabase({ usage: { data: { used: 20 }, error: null } });
    const result = await assertWithinLimit(WORKSPACE, "ai_generations");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Starter");
    expect(result.error.message).toContain("200");
  });

  it("respects a batch size instead of assuming one record", async () => {
    fakeSupabase({ contacts: { count: 45, error: null } });
    expect((await assertWithinLimit(WORKSPACE, "contacts", 5)).ok).toBe(true);

    fakeSupabase({ contacts: { count: 45, error: null } });
    expect((await assertWithinLimit(WORKSPACE, "contacts", 6)).ok).toBe(false);
  });

  it("fails closed - and without leaking the database error - when the count cannot be read", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fakeSupabase({ contacts: { count: null, error: { code: "42501" } } });

    const result = await assertWithinLimit(WORKSPACE, "contacts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).not.toBe("limit_reached");
      expect(result.error.message).not.toContain("42501");
      expect(result.error.message).toMatch(/try again/i);
    }
    consoleError.mockRestore();
  });

  it("fails closed when the subscription cannot be read", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fakeSupabase({ subscription: { data: null, error: { code: "PGRST301" } } });

    const result = await assertWithinLimit(WORKSPACE, "contacts");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain("PGRST301");
    consoleError.mockRestore();
  });
});

describe("consumeMeteredUsage", () => {
  it("passes the plan's cap and the current month to the atomic function", async () => {
    const { rpcCalls } = fakeSupabase({ rpc: { data: 7, error: null } });

    const result = await consumeMeteredUsage(WORKSPACE, "ai_generations");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ used: 7, limit: 20 });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("consume_usage");
    expect(rpcCalls[0].args).toMatchObject({
      target_workspace: WORKSPACE,
      target_metric: "ai_generations",
      target_period: usagePeriod(),
      max_allowed: 20,
      amount: 1,
    });
  });

  it("uses the paid cap when the subscription entitles the workspace to it", async () => {
    const { rpcCalls } = fakeSupabase({
      subscription: subscriptionRow("pro", "active"),
      rpc: { data: 4_001, error: null },
    });

    await consumeMeteredUsage(WORKSPACE, "ai_generations", 1);
    expect(rpcCalls[0].args.max_allowed).toBe(5_000);
  });

  it("reports a limit_reached error when the function refuses the increment", async () => {
    fakeSupabase({ rpc: { data: null, error: null } });

    const result = await consumeMeteredUsage(WORKSPACE, "ai_generations");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("limit_reached");
    expect(result.error.message).toContain("Starter");
    expect(result.error.message).toContain("AI drafts");
  });

  it("does not count usage as consumed when the call itself fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fakeSupabase({ rpc: { data: null, error: { code: "57014" } } });

    const result = await consumeMeteredUsage(WORKSPACE, "ai_generations");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown");
      expect(result.error.message).not.toContain("57014");
    }
    consoleError.mockRestore();
  });
});

describe("getWorkspaceEntitlements", () => {
  it("reports the plan in force with every count and the current period", async () => {
    fakeSupabase({
      subscription: subscriptionRow("growth", "active"),
      contacts: { count: 120, error: null },
      products: { count: 8, error: null },
      seats: { count: 2, error: null },
      usage: { data: { used: 37 }, error: null },
    });

    const entitlements = await getWorkspaceEntitlements(WORKSPACE);

    expect(entitlements.plan.key).toBe("growth");
    expect(entitlements.failed).toBe(false);
    expect(entitlements.period).toBe(usagePeriod());
    expect(entitlements.usage).toEqual({
      contacts: 120,
      products: 8,
      seats: 2,
      ai_generations: 37,
    });
    expect(entitlements.subscription?.hasStripeCustomer).toBe(true);
    // The Stripe customer id itself must not travel to the UI.
    expect(Object.keys(entitlements.subscription ?? {})).not.toContain(
      "stripeCustomerId",
    );
  });

  it("shows Free - never the cancelled paid plan - when a subscription has ended", async () => {
    fakeSupabase({
      subscription: subscriptionRow("pro", "canceled"),
      contacts: { count: 900, error: null },
    });

    const entitlements = await getWorkspaceEntitlements(WORKSPACE);
    expect(entitlements.plan.key).toBe("free");
    expect(entitlements.subscription?.storedPlan).toBe("pro");
    expect(entitlements.subscription?.status).toBe("canceled");
  });

  it("flags a failed read instead of quietly reporting zero usage", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fakeSupabase({
      contacts: { count: null, error: { code: "08006" } },
      products: { count: 3, error: null },
    });

    const entitlements = await getWorkspaceEntitlements(WORKSPACE);
    expect(entitlements.failed).toBe(true);
    consoleError.mockRestore();
  });
});
