import { describe, expect, it } from "vitest";

import {
  deriveChannelStatus,
  providerAccountId,
  redactProviderError,
  type ChannelRow,
  type DeriveChannelStatusInput,
} from "@/features/integrations/status";

/**
 * The rule under test: a channel is only ever reported as connected when this
 * deployment could genuinely reach Meta. A stored row is a memory of some past
 * connection on some deployment - it is never, on its own, permission to render
 * "Connected".
 */

const CONFIGURED = {
  envConfigured: true,
  encryptionConfigured: true,
} satisfies Partial<DeriveChannelStatusInput>;

function row(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    status: "connected",
    externalAccountId: "acct_1",
    displayName: "Sakhi Sarees",
    phoneNumberId: "111222333",
    instagramUserId: "999888777",
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastError: null,
    ...overrides,
  };
}

describe("deriveChannelStatus - deployment configuration outranks the row", () => {
  it("reports setup_required even when the row says 'connected'", () => {
    // The important one. A workspace connected on a properly configured
    // deployment, whose row was then restored onto a deployment with no Meta
    // app, must not claim to be connected here: the OAuth app, the Graph API
    // calls and the webhook signature check all need META_APP_*.
    const status = deriveChannelStatus({
      provider: "whatsapp",
      envConfigured: false,
      missingEnv: ["META_APP_ID", "META_APP_SECRET"],
      encryptionConfigured: true,
      row: row({ status: "connected" }),
    });

    expect(status.state).toBe("setup_required");
    expect(status.connected).toBe(false);
    expect(status.canAttemptConnect).toBe(false);
    expect(status.accountId).toBeNull();
    expect(status.connectedAt).toBeNull();
    expect(status.reason).toContain("META_APP_ID");
    expect(status.reason).toContain("META_APP_SECRET");
  });

  it("does the same for Instagram", () => {
    const status = deriveChannelStatus({
      provider: "instagram",
      envConfigured: false,
      encryptionConfigured: true,
      row: row({ status: "connected" }),
    });

    expect(status.state).toBe("setup_required");
    expect(status.connected).toBe(false);
  });

  it("reports setup_required naming the key when encryption is unusable", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      encryptionConfigured: false,
      row: row({ status: "connected" }),
    });

    expect(status.state).toBe("setup_required");
    expect(status.connected).toBe(false);
    expect(status.reason).toContain("INTEGRATION_ENCRYPTION_KEY");
  });

  it("carries through the specific reason a short key was rejected", () => {
    // This is the string `integrationKeyStatus()` produces for a wrong-length
    // key; the seller should see the actual defect, not a generic message.
    const reason =
      "INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes, got 8. Generate one with: openssl rand -base64 32";

    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      encryptionConfigured: false,
      encryptionReason: reason,
      row: row({ status: "connected" }),
    });

    expect(status.state).toBe("setup_required");
    expect(status.reason).toBe(reason);
    expect(status.reason).toContain("INTEGRATION_ENCRYPTION_KEY");
  });

  it("checks the Meta app before the encryption key when both are missing", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      envConfigured: false,
      missingEnv: ["META_VERIFY_TOKEN"],
      encryptionConfigured: false,
      row: null,
    });

    expect(status.state).toBe("setup_required");
    expect(status.reason).toContain("META_VERIFY_TOKEN");
  });
});

describe("deriveChannelStatus - connected", () => {
  it("reports connected when the deployment and the row both check out", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({ status: "connected", phoneNumberId: "111222333" }),
    });

    expect(status.state).toBe("connected");
    expect(status.connected).toBe(true);
    expect(status.accountId).toBe("111222333");
    expect(status.accountLabel).toBe("Sakhi Sarees");
    expect(status.connectedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(status.canAttemptConnect).toBe(false);
  });

  it("uses the Instagram user id for Instagram", () => {
    const status = deriveChannelStatus({
      provider: "instagram",
      ...CONFIGURED,
      row: row({ status: "connected", instagramUserId: "999888777" }),
    });

    expect(status.state).toBe("connected");
    expect(status.accountId).toBe("999888777");
  });

  it("does not claim connected when the provider account id is missing", () => {
    // A half-finished authorisation. Without a phone number id there is no
    // address to send from, so this is pending work, not a live channel.
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({ status: "connected", phoneNumberId: null }),
    });

    expect(status.connected).toBe(false);
    expect(status.state).not.toBe("connected");
    expect(status.state).toBe("pending");
    expect(status.accountId).toBeNull();
    expect(status.reason).toContain("phone number id");
  });

  it("does not accept a blank account id, or the wrong provider's id", () => {
    const blank = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({ status: "connected", phoneNumberId: "   " }),
    });
    expect(blank.connected).toBe(false);

    // An Instagram id is not a substitute for a WhatsApp phone number id, and
    // neither is the generic app-scoped account id.
    const wrongProvider = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({
        status: "connected",
        phoneNumberId: null,
        instagramUserId: "999888777",
        externalAccountId: "acct_1",
      }),
    });
    expect(wrongProvider.connected).toBe(false);
    expect(wrongProvider.accountId).toBeNull();
  });
});

describe("deriveChannelStatus - the other row states", () => {
  it("reports not_configured when there is no row at all", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: null,
    });

    expect(status.state).toBe("not_configured");
    expect(status.connected).toBe(false);
    expect(status.canAttemptConnect).toBe(true);
  });

  it("reports not_configured for a row that was never connected", () => {
    const status = deriveChannelStatus({
      provider: "instagram",
      ...CONFIGURED,
      row: row({ status: "not_configured" }),
    });

    expect(status.state).toBe("not_configured");
    expect(status.connected).toBe(false);
  });

  it("reports disconnected for a disconnected row", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({ status: "disconnected" }),
    });

    expect(status.state).toBe("disconnected");
    expect(status.connected).toBe(false);
    expect(status.canAttemptConnect).toBe(true);
  });

  it("reports pending for a half-finished connection", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({ status: "pending", phoneNumberId: null }),
    });

    expect(status.state).toBe("pending");
    expect(status.connected).toBe(false);
    expect(status.canAttemptConnect).toBe(true);
  });

  it("reports error and carries the reason through", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({
        status: "error",
        lastError: "Message failed: template not approved for this waba.",
      }),
    });

    expect(status.state).toBe("error");
    expect(status.connected).toBe(false);
    expect(status.canAttemptConnect).toBe(true);
    expect(status.reason).toContain("template not approved");
  });

  it("still says something useful for an error row with no message", () => {
    const status = deriveChannelStatus({
      provider: "instagram",
      ...CONFIGURED,
      row: row({ status: "error", lastError: null }),
    });

    expect(status.state).toBe("error");
    expect(status.reason.length).toBeGreaterThan(0);
  });
});

describe("redactProviderError", () => {
  it("removes access tokens from a Meta error string", () => {
    const raw =
      "OAuthException: Error validating access token EAAJk2ZAqPZBs0BO7ZCw1Zx9dQmVcTgZDZD for user";
    const safe = redactProviderError(raw);

    expect(safe).not.toContain("EAAJk2ZAqPZBs0BO7ZCw1Zx9dQmVcTgZDZD");
    expect(safe).toContain("[redacted]");
    expect(safe).toContain("OAuthException");
  });

  it("removes phone numbers, emails and URL query strings", () => {
    const safe = redactProviderError(
      "Delivery to +91 98765 43210 failed; notify seller@example.com; see https://graph.facebook.com/v19.0/me?access_token=secretvalue",
    );

    expect(safe).not.toContain("98765");
    expect(safe).not.toContain("seller@example.com");
    expect(safe).not.toContain("access_token");
    expect(safe).not.toContain("secretvalue");
  });

  it("truncates a very long provider dump", () => {
    const safe = redactProviderError("failure. ".repeat(200));
    expect(safe.length).toBeLessThanOrEqual(200);
  });

  it("falls back to a plain sentence for an empty error", () => {
    expect(redactProviderError(null)).toMatch(/problem/i);
    expect(redactProviderError("   ")).toMatch(/problem/i);
  });

  it("never leaks a raw error through deriveChannelStatus", () => {
    const status = deriveChannelStatus({
      provider: "whatsapp",
      ...CONFIGURED,
      row: row({
        status: "error",
        lastError: "token EAAJk2ZAqPZBs0BO7ZCw1Zx9dQmVcTgZDZD expired",
      }),
    });

    expect(status.reason).not.toContain("EAAJk2ZAqPZBs0BO7ZCw1Zx9dQmVcTgZDZD");
  });
});

describe("providerAccountId", () => {
  it("picks the id that the provider can actually send from", () => {
    expect(providerAccountId("whatsapp", row())).toBe("111222333");
    expect(providerAccountId("instagram", row())).toBe("999888777");
    expect(providerAccountId("whatsapp", null)).toBeNull();
    expect(
      providerAccountId("instagram", row({ instagramUserId: "" })),
    ).toBeNull();
  });
});
