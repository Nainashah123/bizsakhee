/**
 * Stripe event -> subscription state mapping.
 *
 * @vitest-environment node
 *
 * The mapping reads price ids through `serverEnv()`, which refuses to run where
 * `window` exists - the guard that keeps Stripe configuration server-side.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mapping reaches `lib/stripe/prices`, which is server-only code. The marker
// package throws outside a React Server Component, so it is stubbed out. No
// business logic of ours is mocked - the function under test is pure.
vi.mock("server-only", () => ({}));

import { __resetEnvCacheForTests } from "@/lib/env";
import { effectivePlan, isEntitlingStatus } from "@/lib/plans";
import {
  HANDLED_STRIPE_EVENT_TYPES,
  isHandledStripeEventType,
  subscriptionStateFromEvent,
  type StripeEventInput,
  type WebhookOutcome,
} from "@/lib/stripe/webhook-handlers";

const WORKSPACE = "3f1c0c9e-6a3d-4d21-8f0a-2a6b7c8d9e01";
const OTHER_WORKSPACE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const CUSTOMER = "cus_TEST123";
const SUBSCRIPTION = "sub_TEST123";

const STARTER_MONTH = "price_starter_month_abc";
const GROWTH_YEAR = "price_growth_year_abc";
const UNKNOWN_PRICE = "price_from_another_account";

/** 2026-01-01T00:00:00Z */
const EVENT_CREATED = 1_767_225_600;
/** 2026-02-01T00:00:00Z */
const PERIOD_END = 1_769_904_000;

const EVENT_CREATED_ISO = new Date(EVENT_CREATED * 1000).toISOString();
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy");
  vi.stubEnv("STRIPE_STARTER_MONTHLY_PRICE_ID", STARTER_MONTH);
  vi.stubEnv("STRIPE_STARTER_ANNUAL_PRICE_ID", "price_starter_year_abc");
  vi.stubEnv("STRIPE_GROWTH_MONTHLY_PRICE_ID", "price_growth_month_abc");
  vi.stubEnv("STRIPE_GROWTH_ANNUAL_PRICE_ID", GROWTH_YEAR);
  vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_pro_month_abc");
  vi.stubEnv("STRIPE_PRO_ANNUAL_PRICE_ID", "price_pro_year_abc");
  __resetEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

function event(type: string, object: unknown): StripeEventInput {
  return {
    id: `evt_${type.replace(/[^a-z]/gi, "_")}`,
    type,
    created: EVENT_CREATED,
    data: { object },
  };
}

function subscriptionObject(
  overrides: Record<string, unknown> = {},
  priceId: string | null = STARTER_MONTH,
) {
  return {
    id: SUBSCRIPTION,
    status: "active",
    customer: CUSTOMER,
    cancel_at_period_end: false,
    metadata: { workspace_id: WORKSPACE },
    items: {
      data: [
        {
          current_period_end: PERIOD_END,
          price: priceId === null ? null : { id: priceId },
        },
      ],
    },
    ...overrides,
  };
}

function invoiceObject(overrides: Record<string, unknown> = {}) {
  return {
    customer: CUSTOMER,
    billing_reason: "subscription_cycle",
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: SUBSCRIPTION,
        metadata: { workspace_id: WORKSPACE },
      },
    },
    ...overrides,
  };
}

function expectApply(outcome: WebhookOutcome) {
  if (outcome.kind !== "apply") {
    throw new Error(
      `expected an "apply" outcome, got "${outcome.kind}" (${JSON.stringify(outcome)})`,
    );
  }
  return outcome;
}

describe("handled event types", () => {
  it("covers exactly the six subscription lifecycle events", () => {
    expect([...HANDLED_STRIPE_EVENT_TYPES]).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ]);

    for (const type of HANDLED_STRIPE_EVENT_TYPES) {
      expect(isHandledStripeEventType(type)).toBe(true);
    }
    expect(isHandledStripeEventType("payment_intent.succeeded")).toBe(false);
  });

  it("classifies an unhandled event type as ignorable, not an error", () => {
    for (const type of [
      "payment_intent.succeeded",
      "charge.refunded",
      "customer.updated",
      "account.updated",
      "",
    ]) {
      const outcome = subscriptionStateFromEvent(event(type, { id: "obj" }));
      expect(outcome.kind).toBe("ignored");
      if (outcome.kind === "ignored") {
        expect(outcome.reason).toBe("unhandled_event_type");
      }
    }
  });
});

describe("checkout.session.completed", () => {
  it("links the Stripe ids but grants no plan or status", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("checkout.session.completed", {
          mode: "subscription",
          customer: CUSTOMER,
          subscription: SUBSCRIPTION,
          client_reference_id: WORKSPACE,
          metadata: { workspace_id: WORKSPACE },
        }),
      ),
    );

    expect(outcome.customerId).toBe(CUSTOMER);
    expect(outcome.workspaceId).toBe(WORKSPACE);
    expect(outcome.patch).toEqual({
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: SUBSCRIPTION,
    });
    // A completed session is not proof of payment: the plan and status come
    // only from the subscription events.
    expect(outcome.patch.plan).toBeUndefined();
    expect(outcome.patch.status).toBeUndefined();
  });

  it("accepts expanded objects and falls back to client_reference_id", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("checkout.session.completed", {
          mode: "subscription",
          customer: { id: CUSTOMER },
          subscription: { id: SUBSCRIPTION },
          client_reference_id: WORKSPACE,
          metadata: {},
        }),
      ),
    );

    expect(outcome.customerId).toBe(CUSTOMER);
    expect(outcome.workspaceId).toBe(WORKSPACE);
  });

  it("prefers metadata over client_reference_id when both are present", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("checkout.session.completed", {
          mode: "subscription",
          customer: CUSTOMER,
          client_reference_id: OTHER_WORKSPACE,
          metadata: { workspace_id: WORKSPACE },
        }),
      ),
    );

    expect(outcome.workspaceId).toBe(WORKSPACE);
  });

  it("ignores a workspace reference that is not a uuid", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("checkout.session.completed", {
          mode: "subscription",
          customer: CUSTOMER,
          client_reference_id: "'; drop table subscriptions; --",
          metadata: { workspace_id: "not-a-uuid" },
        }),
      ),
    );

    expect(outcome.workspaceId).toBeNull();
    expect(outcome.customerId).toBe(CUSTOMER);
  });

  it("ignores a one-off payment checkout", () => {
    const outcome = subscriptionStateFromEvent(
      event("checkout.session.completed", {
        mode: "payment",
        customer: CUSTOMER,
        metadata: { workspace_id: WORKSPACE },
      }),
    );

    expect(outcome.kind).toBe("ignored");
    if (outcome.kind === "ignored") {
      expect(outcome.reason).toBe("non_subscription_checkout");
    }
  });
});

describe("customer.subscription.created / updated", () => {
  it("maps a known monthly price to its plan and persists the period", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("customer.subscription.created", subscriptionObject()),
      ),
    );

    expect(outcome.warnings).toEqual([]);
    expect(outcome.patch).toEqual({
      plan: "starter",
      status: "active",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: SUBSCRIPTION,
      stripe_price_id: STARTER_MONTH,
      interval: "month",
      current_period_end: PERIOD_END_ISO,
      cancel_at_period_end: false,
      payment_failed_at: null,
    });
  });

  it("maps a known annual price to the yearly interval", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.updated",
          subscriptionObject({}, GROWTH_YEAR),
        ),
      ),
    );

    expect(outcome.patch.plan).toBe("growth");
    expect(outcome.patch.interval).toBe("year");
  });

  it("records a pending cancellation without removing the plan", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.updated",
          subscriptionObject({ cancel_at_period_end: true }),
        ),
      ),
    );

    expect(outcome.patch.cancel_at_period_end).toBe(true);
    expect(outcome.patch.plan).toBe("starter");
    expect(outcome.patch.status).toBe("active");
  });

  it("falls back to Free for a price id it does not recognise", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.updated",
          subscriptionObject({}, UNKNOWN_PRICE),
        ),
      ),
    );

    expect(outcome.warnings).toEqual(["unrecognised_price"]);
    expect(outcome.patch.plan).toBe("free");
    expect(outcome.patch.interval).toBeNull();
    // The raw price is still recorded so the mismatch is diagnosable.
    expect(outcome.patch.stripe_price_id).toBe(UNKNOWN_PRICE);

    // The decisive assertion: an unknown price grants nothing, even though the
    // subscription itself is active.
    expect(
      effectivePlan({
        plan: outcome.patch.plan,
        status: outcome.patch.status,
      }).key,
    ).toBe("free");
  });

  it("falls back to Free when the subscription carries no price at all", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("customer.subscription.updated", subscriptionObject({}, null)),
      ),
    );

    expect(outcome.warnings).toEqual(["missing_price"]);
    expect(outcome.patch.plan).toBe("free");
    expect(outcome.patch.stripe_price_id).toBeNull();
  });

  it("does not grant a paid plan when a price is unconfigured at runtime", () => {
    // Simulates the environment variable being removed after a customer was
    // already subscribed to that price.
    vi.stubEnv("STRIPE_STARTER_MONTHLY_PRICE_ID", undefined);
    __resetEnvCacheForTests();

    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("customer.subscription.updated", subscriptionObject()),
      ),
    );

    expect(outcome.patch.plan).toBe("free");
    expect(outcome.warnings).toEqual(["unrecognised_price"]);
  });

  it("passes Stripe's non-entitling statuses through unchanged", () => {
    for (const status of [
      "trialing",
      "past_due",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "paused",
      "canceled",
    ]) {
      const outcome = expectApply(
        subscriptionStateFromEvent(
          event(
            "customer.subscription.updated",
            subscriptionObject({ status }),
          ),
        ),
      );
      expect(outcome.patch.status).toBe(status);
      expect(outcome.warnings).toEqual([]);
    }
  });

  it("treats a status it does not know as non-entitling", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.updated",
          subscriptionObject({ status: "some_future_status" }),
        ),
      ),
    );

    expect(outcome.warnings).toEqual(["unknown_subscription_status"]);
    expect(outcome.patch.status).toBe("incomplete");
    expect(isEntitlingStatus(outcome.patch.status)).toBe(false);
  });

  it("clears a stale payment failure once the subscription is healthy", () => {
    for (const status of ["active", "trialing"]) {
      const outcome = expectApply(
        subscriptionStateFromEvent(
          event(
            "customer.subscription.updated",
            subscriptionObject({ status }),
          ),
        ),
      );
      expect(outcome.patch.payment_failed_at).toBeNull();
    }

    // ...but a past_due subscription keeps whatever flag is already stored.
    const pastDue = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.updated",
          subscriptionObject({ status: "past_due" }),
        ),
      ),
    );
    expect(pastDue.patch.payment_failed_at).toBeUndefined();
  });

  it("reads a period end from the legacy top-level field", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("customer.subscription.updated", {
          id: SUBSCRIPTION,
          status: "active",
          customer: CUSTOMER,
          current_period_end: PERIOD_END,
          metadata: { workspace_id: WORKSPACE },
          items: { data: [{ price: { id: STARTER_MONTH } }] },
        }),
      ),
    );

    expect(outcome.patch.current_period_end).toBe(PERIOD_END_ISO);
  });

  it("is unprocessable when the payload is not a subscription", () => {
    const outcome = subscriptionStateFromEvent(
      event("customer.subscription.updated", { nonsense: true }),
    );

    expect(outcome.kind).toBe("unprocessable");
    if (outcome.kind === "unprocessable") {
      expect(outcome.reason).toBe("malformed_subscription");
    }
  });

  it("is unprocessable when nothing identifies the workspace", () => {
    const outcome = subscriptionStateFromEvent(
      event(
        "customer.subscription.updated",
        subscriptionObject({ customer: null, metadata: {} }),
      ),
    );

    expect(outcome.kind).toBe("unprocessable");
    if (outcome.kind === "unprocessable") {
      expect(outcome.reason).toBe("no_workspace_reference");
    }
  });
});

describe("customer.subscription.deleted", () => {
  it("drops the workspace to Free and marks it canceled", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.deleted",
          subscriptionObject({ status: "canceled" }),
        ),
      ),
    );

    expect(outcome.patch).toEqual({
      plan: "free",
      status: "canceled",
      stripe_customer_id: CUSTOMER,
      // Cleared: the column is UNIQUE and the subscription no longer exists.
      stripe_subscription_id: null,
      stripe_price_id: null,
      interval: null,
      cancel_at_period_end: false,
      current_period_end: PERIOD_END_ISO,
      payment_failed_at: null,
    });

    expect(effectivePlan(outcome.patch).key).toBe("free");
    expect(isEntitlingStatus(outcome.patch.status)).toBe(false);
  });

  it("still drops to Free when the deleted subscription had a paid price", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "customer.subscription.deleted",
          subscriptionObject({ status: "active" }, GROWTH_YEAR),
        ),
      ),
    );

    expect(outcome.patch.plan).toBe("free");
    expect(outcome.patch.status).toBe("canceled");
  });
});

describe("invoice.payment_failed", () => {
  it("marks a failed renewal past_due and stamps payment_failed_at", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("invoice.payment_failed", invoiceObject()),
      ),
    );

    expect(outcome.customerId).toBe(CUSTOMER);
    expect(outcome.workspaceId).toBe(WORKSPACE);
    expect(outcome.patch).toEqual({
      status: "past_due",
      payment_failed_at: EVENT_CREATED_ISO,
      stripe_customer_id: CUSTOMER,
    });

    // past_due deliberately still entitles: Stripe is retrying the card.
    expect(isEntitlingStatus(outcome.patch.status)).toBe(true);
  });

  it("does not invent past_due when the very first payment fails", () => {
    // A subscription whose first invoice fails is `incomplete` and was never
    // entitling. Writing past_due here would hand out a plan nobody paid for.
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event(
          "invoice.payment_failed",
          invoiceObject({ billing_reason: "subscription_create" }),
        ),
      ),
    );

    expect(outcome.patch.status).toBeUndefined();
    expect(outcome.patch.payment_failed_at).toBe(EVENT_CREATED_ISO);
  });

  it("derives the timestamp from the event, not the wall clock", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent({
        id: "evt_1",
        type: "invoice.payment_failed",
        created: 1_000_000_000,
        data: { object: invoiceObject() },
      }),
    );

    expect(outcome.patch.payment_failed_at).toBe(
      new Date(1_000_000_000 * 1000).toISOString(),
    );
  });
});

describe("invoice.paid", () => {
  it("clears payment_failed_at and leaves the status to subscription events", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(event("invoice.paid", invoiceObject())),
    );

    expect(outcome.patch).toEqual({
      payment_failed_at: null,
      stripe_customer_id: CUSTOMER,
    });
    expect(outcome.patch.status).toBeUndefined();
    expect(outcome.patch.plan).toBeUndefined();
  });

  it("routes on the metadata snapshot when the customer is absent", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("invoice.paid", invoiceObject({ customer: null })),
      ),
    );

    expect(outcome.customerId).toBeNull();
    expect(outcome.workspaceId).toBe(WORKSPACE);
  });

  it("accepts the pre-2025 top-level subscription field", () => {
    const outcome = expectApply(
      subscriptionStateFromEvent(
        event("invoice.paid", {
          customer: CUSTOMER,
          subscription: SUBSCRIPTION,
        }),
      ),
    );

    expect(outcome.patch.payment_failed_at).toBeNull();
  });

  it("ignores an invoice that belongs to no subscription", () => {
    for (const type of ["invoice.paid", "invoice.payment_failed"]) {
      const outcome = subscriptionStateFromEvent(
        event(type, { customer: CUSTOMER, billing_reason: "manual" }),
      );

      expect(outcome.kind).toBe("ignored");
      if (outcome.kind === "ignored") {
        expect(outcome.reason).toBe("non_subscription_invoice");
      }
    }
  });

  it("is unprocessable when the payload is not an invoice", () => {
    const outcome = subscriptionStateFromEvent(
      event("invoice.paid", { customer: 42 }),
    );

    expect(outcome.kind).toBe("unprocessable");
    if (outcome.kind === "unprocessable") {
      expect(outcome.reason).toBe("malformed_invoice");
    }
  });
});

describe("purity", () => {
  it("returns the same outcome for the same event every time", () => {
    const input = event("customer.subscription.updated", subscriptionObject());

    const first = subscriptionStateFromEvent(input);
    const second = subscriptionStateFromEvent(input);

    expect(first).toEqual(second);
  });

  it("does not mutate the event it is given", () => {
    const input = event("customer.subscription.updated", subscriptionObject());
    const snapshot = JSON.stringify(input);

    subscriptionStateFromEvent(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
