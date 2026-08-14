/**
 * The WhatsApp 24-hour customer service window.
 *
 * This rule decides whether a seller may type a reply or must pick an approved
 * template, so the boundary conditions matter more than the happy path.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertFreeFormAllowed,
  CUSTOMER_WINDOW_MS,
  customerWindowExpiryFrom,
  customerWindowRemainingMs,
  describeSendPolicy,
  isWithinCustomerWindow,
  TEMPLATE_REQUIRED_MESSAGE,
} from "@/lib/integrations/meta/whatsapp";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe("customerWindowExpiryFrom", () => {
  it("is exactly 24 hours after the customer's message", () => {
    expect(customerWindowExpiryFrom("2026-08-14T12:00:00.000Z")).toBe(
      "2026-08-15T12:00:00.000Z",
    );
    expect(CUSTOMER_WINDOW_MS).toBe(24 * HOUR);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(customerWindowExpiryFrom(NOW)).toBe(
      customerWindowExpiryFrom(NOW.toISOString()),
    );
  });

  it("returns null for an unusable timestamp rather than an Invalid Date", () => {
    for (const value of ["", "yesterday", "2026-13-45T99:99:99Z"]) {
      expect(customerWindowExpiryFrom(value)).toBeNull();
    }
  });
});

describe("isWithinCustomerWindow", () => {
  it("allows a free-form message inside the window", () => {
    expect(isWithinCustomerWindow(at(1 * HOUR), NOW)).toBe(true);
    expect(isWithinCustomerWindow(at(1), NOW)).toBe(true);
    expect(isWithinCustomerWindow(at(23 * HOUR), NOW)).toBe(true);
  });

  it("is closed at the exact moment of expiry", () => {
    // Exclusive, because Meta treats the boundary as closed. An off-by-one here
    // is a rejected send and a policy strike.
    expect(isWithinCustomerWindow(NOW.toISOString(), NOW)).toBe(false);
    expect(isWithinCustomerWindow(at(-1), NOW)).toBe(false);
  });

  it("is closed after expiry", () => {
    expect(isWithinCustomerWindow(at(-1 * HOUR), NOW)).toBe(false);
    expect(isWithinCustomerWindow(at(-30 * 24 * HOUR), NOW)).toBe(false);
  });

  it("treats a null expiry as no window at all, not an open one", () => {
    // The dangerous default: a conversation the customer has never written to.
    expect(isWithinCustomerWindow(null, NOW)).toBe(false);
    expect(isWithinCustomerWindow(undefined, NOW)).toBe(false);
    expect(isWithinCustomerWindow("", NOW)).toBe(false);
    expect(isWithinCustomerWindow("not-a-date", NOW)).toBe(false);
  });
});

describe("customerWindowRemainingMs", () => {
  it("counts down and never goes negative", () => {
    expect(customerWindowRemainingMs(at(2 * HOUR), NOW)).toBe(2 * HOUR);
    expect(customerWindowRemainingMs(NOW.toISOString(), NOW)).toBe(0);
    expect(customerWindowRemainingMs(at(-5 * HOUR), NOW)).toBe(0);
    expect(customerWindowRemainingMs(null, NOW)).toBe(0);
  });
});

describe("describeSendPolicy", () => {
  it("permits free-form inside the window and requires a template outside it", () => {
    const open = describeSendPolicy(at(3 * HOUR), NOW);
    expect(open).toEqual({
      freeFormAllowed: true,
      templateRequired: false,
      remainingMs: 3 * HOUR,
      expiresAt: at(3 * HOUR),
    });

    const closed = describeSendPolicy(at(-3 * HOUR), NOW);
    expect(closed).toEqual({
      freeFormAllowed: false,
      templateRequired: true,
      remainingMs: 0,
      expiresAt: at(-3 * HOUR),
    });
  });

  it("requires a template when no window was ever opened", () => {
    expect(describeSendPolicy(null, NOW)).toEqual({
      freeFormAllowed: false,
      templateRequired: true,
      remainingMs: 0,
      expiresAt: null,
    });
  });

  it("never reports both free-form and template-required", () => {
    for (const offset of [-HOUR, -1, 0, 1, HOUR, 24 * HOUR]) {
      const policy = describeSendPolicy(at(offset), NOW);
      expect(policy.freeFormAllowed).toBe(!policy.templateRequired);
    }
  });
});

describe("assertFreeFormAllowed", () => {
  it("passes inside the window", () => {
    expect(assertFreeFormAllowed(at(HOUR), NOW).ok).toBe(true);
  });

  it("refuses at and after expiry, naming the template requirement", () => {
    for (const expiry of [NOW.toISOString(), at(-1), at(-48 * HOUR)]) {
      const result = assertFreeFormAllowed(expiry, NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation");
        expect(result.error.message).toBe(TEMPLATE_REQUIRED_MESSAGE);
        expect(result.error.message.toLowerCase()).toContain("template");
        expect(result.error.message).toContain("24 hours");
      }
    }
  });

  it("refuses, with different wording, when the customer never wrote first", () => {
    const result = assertFreeFormAllowed(null, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.message.toLowerCase()).toContain("template");
      expect(result.error.message).not.toBe(TEMPLATE_REQUIRED_MESSAGE);
    }
  });

  it("agrees with describeSendPolicy at every boundary", () => {
    // One rule, two entry points: the composer and the send service must never
    // disagree about whether a reply is allowed.
    for (const offset of [-2 * HOUR, -1, 0, 1, 2 * HOUR]) {
      const expiry = at(offset);
      expect(assertFreeFormAllowed(expiry, NOW).ok).toBe(
        describeSendPolicy(expiry, NOW).freeFormAllowed,
      );
    }
  });
});
