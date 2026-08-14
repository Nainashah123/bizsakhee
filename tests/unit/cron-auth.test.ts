import { describe, expect, it } from "vitest";

import {
  authorizeCronRequest,
  extractBearerToken,
  timingSafeEqualStrings,
} from "@/lib/cron/auth";

const SECRET = "s3cret-cron-value-9f2b";

describe("timingSafeEqualStrings", () => {
  it("accepts identical strings", () => {
    expect(timingSafeEqualStrings(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualStrings("", "")).toBe(true);
  });

  it("rejects a same-length string that differs by one character", () => {
    const nearMiss = `${SECRET.slice(0, -1)}c`;
    expect(nearMiss).toHaveLength(SECRET.length);
    expect(nearMiss).not.toBe(SECRET);
    expect(timingSafeEqualStrings(nearMiss, SECRET)).toBe(false);
  });

  it("rejects shorter and longer inputs without throwing", () => {
    // node:crypto's timingSafeEqual throws on differing buffer lengths, which
    // is exactly the case a naive implementation forgets.
    expect(() =>
      timingSafeEqualStrings(SECRET.slice(0, 4), SECRET),
    ).not.toThrow();
    expect(timingSafeEqualStrings(SECRET.slice(0, 4), SECRET)).toBe(false);

    expect(() =>
      timingSafeEqualStrings(`${SECRET}extra`, SECRET),
    ).not.toThrow();
    expect(timingSafeEqualStrings(`${SECRET}extra`, SECRET)).toBe(false);

    expect(timingSafeEqualStrings("", SECRET)).toBe(false);
    expect(timingSafeEqualStrings(SECRET, "")).toBe(false);

    const veryLong = "x".repeat(100_000);
    expect(() => timingSafeEqualStrings(veryLong, SECRET)).not.toThrow();
    expect(timingSafeEqualStrings(veryLong, SECRET)).toBe(false);
  });

  it("is not fooled by a prefix", () => {
    expect(timingSafeEqualStrings("s3cret", SECRET)).toBe(false);
  });

  it("handles multi-byte characters", () => {
    expect(timingSafeEqualStrings("पासवर्ड", "पासवर्ड")).toBe(true);
    expect(timingSafeEqualStrings("पासवर्ड", "पासवर्द")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("reads the token regardless of scheme casing or padding", () => {
    expect(extractBearerToken(`Bearer ${SECRET}`)).toBe(SECRET);
    expect(extractBearerToken(`bearer ${SECRET}`)).toBe(SECRET);
    expect(extractBearerToken(`BEARER ${SECRET}`)).toBe(SECRET);
    expect(extractBearerToken(`  Bearer   ${SECRET}  `)).toBe(SECRET);
  });

  it("returns null for anything that is not a bearer token", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken(SECRET)).toBeNull();
    expect(extractBearerToken(`Basic ${SECRET}`)).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
    expect(extractBearerToken("Bearer    ")).toBeNull();
  });
});

describe("authorizeCronRequest", () => {
  it("authorises the configured secret", () => {
    const result = authorizeCronRequest(`Bearer ${SECRET}`, SECRET);
    expect(result.status).toBe("authorized");
  });

  it("rejects a wrong secret", () => {
    expect(
      authorizeCronRequest("Bearer completely-different", SECRET).status,
    ).toBe("unauthorized");
  });

  it("rejects shorter and longer tokens without throwing", () => {
    expect(() =>
      authorizeCronRequest(`Bearer ${SECRET.slice(0, 6)}`, SECRET),
    ).not.toThrow();
    expect(
      authorizeCronRequest(`Bearer ${SECRET.slice(0, 6)}`, SECRET).status,
    ).toBe("unauthorized");
    expect(
      authorizeCronRequest(`Bearer ${SECRET}-and-then-some`, SECRET).status,
    ).toBe("unauthorized");
  });

  it("rejects a missing or malformed Authorization header", () => {
    expect(authorizeCronRequest(null, SECRET).status).toBe("unauthorized");
    expect(authorizeCronRequest(undefined, SECRET).status).toBe("unauthorized");
    expect(authorizeCronRequest("", SECRET).status).toBe("unauthorized");
    expect(authorizeCronRequest(SECRET, SECRET).status).toBe("unauthorized");
    expect(authorizeCronRequest(`Basic ${SECRET}`, SECRET).status).toBe(
      "unauthorized",
    );
  });

  it("reports not_configured when CRON_SECRET is absent, and never authorises", () => {
    for (const secret of [undefined, null, "", "   ", "\n\t"]) {
      expect(authorizeCronRequest(`Bearer ${SECRET}`, secret).status).toBe(
        "not_configured",
      );
      // A blank secret must not be matchable by sending a blank token either.
      expect(authorizeCronRequest("Bearer  ", secret).status).toBe(
        "not_configured",
      );
      expect(authorizeCronRequest(null, secret).status).toBe("not_configured");
    }
  });

  it("checks configuration before the header, so no header can slip through", () => {
    const statuses = [
      authorizeCronRequest("Bearer ", ""),
      authorizeCronRequest("Bearer undefined", undefined),
      authorizeCronRequest("Bearer null", null),
    ].map((result) => result.status);

    expect(statuses).toEqual([
      "not_configured",
      "not_configured",
      "not_configured",
    ]);
  });

  it("never echoes the secret or the presented token in its reason", () => {
    const results = [
      authorizeCronRequest(`Bearer ${SECRET}`, SECRET),
      authorizeCronRequest("Bearer wrong-token-value", SECRET),
      authorizeCronRequest(null, SECRET),
      authorizeCronRequest(`Bearer ${SECRET}`, undefined),
    ];

    for (const result of results) {
      expect(result.reason).not.toContain(SECRET);
      expect(result.reason).not.toContain("wrong-token-value");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
