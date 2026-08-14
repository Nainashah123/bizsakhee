/**
 * Meta webhook authenticity: the HMAC on POST deliveries, and the GET handshake.
 *
 * @vitest-environment node
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component graph. It is a build
// guard, not runtime behaviour, so it is stubbed out for the test.
vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/meta/webhook/route";
import { __resetEnvCacheForTests } from "@/lib/env";
import {
  SIGNATURE_HEADER,
  verifyMetaChallenge,
  verifyMetaSignature,
} from "@/lib/integrations/meta/signature";

const APP_SECRET = "meta-app-secret-3f9c1a";
const VERIFY_TOKEN = "bizsakhi-verify-7b2e";

/** Exactly what Meta puts in `X-Hub-Signature-256`. */
function signatureFor(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const BODY = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "102290129340398", changes: [] }],
});

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
  vi.stubEnv("META_VERIFY_TOKEN", VERIFY_TOKEN);
  __resetEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

describe("verifyMetaSignature", () => {
  it("accepts a correctly computed digest", () => {
    expect(verifyMetaSignature(BODY, signatureFor(BODY))).toEqual({
      valid: true,
    });
  });

  it("reads the app secret from the environment when none is passed", () => {
    // The webhook route relies on this default, so it is worth asserting.
    expect(verifyMetaSignature(BODY, signatureFor(BODY)).valid).toBe(true);

    vi.stubEnv("META_APP_SECRET", "a-completely-different-secret");
    __resetEnvCacheForTests();
    expect(verifyMetaSignature(BODY, signatureFor(BODY)).valid).toBe(false);
  });

  it("rejects a digest computed with the wrong secret", () => {
    const forged = signatureFor(BODY, "not-the-app-secret");
    expect(verifyMetaSignature(BODY, forged)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a tampered body, even by one character", () => {
    const signature = signatureFor(BODY);
    const tampered = BODY.replace("102290129340398", "102290129340399");

    expect(tampered).not.toBe(BODY);
    expect(tampered).toHaveLength(BODY.length);
    expect(verifyMetaSignature(tampered, signature)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects re-serialised JSON, which is why the raw body is required", () => {
    // Parsing and re-stringifying reorders nothing here, but whitespace alone
    // is enough to break the HMAC - the exact failure this contract prevents.
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyMetaSignature(reserialised, signatureFor(BODY)).valid).toBe(
      false,
    );
  });

  it("rejects a missing header", () => {
    for (const header of [null, undefined, ""]) {
      expect(verifyMetaSignature(BODY, header)).toEqual({
        valid: false,
        reason: "missing",
      });
    }
  });

  it("rejects sha1, which Meta also offers and we do not accept", () => {
    const sha1 = `sha1=${createHmac("sha1", APP_SECRET).update(BODY, "utf8").digest("hex")}`;
    expect(verifyMetaSignature(BODY, sha1)).toEqual({
      valid: false,
      reason: "malformed",
    });

    // A bare digest with no algorithm prefix is equally unacceptable.
    expect(
      verifyMetaSignature(BODY, signatureFor(BODY).replace("sha256=", ""))
        .valid,
    ).toBe(false);
  });

  it("rejects a non-hex digest without throwing", () => {
    const notHex = `sha256=${"z".repeat(64)}`;
    expect(() => verifyMetaSignature(BODY, notHex)).not.toThrow();
    expect(verifyMetaSignature(BODY, notHex)).toEqual({
      valid: false,
      reason: "malformed",
    });

    // Base64 of the right digest is still not hex.
    const base64 = `sha256=${createHmac("sha256", APP_SECRET).update(BODY, "utf8").digest("base64")}`;
    expect(verifyMetaSignature(BODY, base64).valid).toBe(false);
  });

  it("rejects a digest of the wrong length without throwing", () => {
    // node's timingSafeEqual throws on mismatched buffer lengths; a truncated
    // digest must not turn a forged request into a 500.
    const full = signatureFor(BODY).slice("sha256=".length);

    for (const digest of [full.slice(0, 32), full.slice(0, 63), `${full}ab`]) {
      const header = `sha256=${digest}`;
      expect(() => verifyMetaSignature(BODY, header)).not.toThrow();
      expect(verifyMetaSignature(BODY, header).valid).toBe(false);
    }
  });

  it("fails closed when the app secret is unset", () => {
    vi.stubEnv("META_APP_SECRET", undefined);
    __resetEnvCacheForTests();

    // Every plausible signature, including a correct one for an empty secret.
    for (const header of [
      signatureFor(BODY),
      signatureFor(BODY, ""),
      null,
      `sha256=${"0".repeat(64)}`,
    ]) {
      expect(verifyMetaSignature(BODY, header)).toEqual({
        valid: false,
        reason: "not_configured",
      });
    }

    // And explicitly: an empty secret is not a usable key.
    expect(verifyMetaSignature(BODY, signatureFor(BODY), "").valid).toBe(false);
  });

  it("names the header Meta actually sends, in lowercase", () => {
    expect(SIGNATURE_HEADER).toBe("x-hub-signature-256");
  });
});

describe("verifyMetaChallenge", () => {
  function params(overrides: Record<string, string> = {}) {
    return new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "1158201444",
      ...overrides,
    });
  }

  it("echoes the challenge for the configured token", () => {
    expect(verifyMetaChallenge(params())).toEqual({
      ok: true,
      challenge: "1158201444",
    });
  });

  it("refuses a wrong token, a wrong mode and a missing challenge", () => {
    const cases = [
      params({ "hub.verify_token": "wrong-token-value" }),
      params({ "hub.verify_token": VERIFY_TOKEN.slice(0, -1) }),
      params({ "hub.mode": "unsubscribe" }),
      new URLSearchParams(),
    ];

    for (const candidate of cases) {
      const result = verifyMetaChallenge(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    }
  });

  it("reports 503 - not 403 - when no verify token is configured", () => {
    vi.stubEnv("META_VERIFY_TOKEN", undefined);
    __resetEnvCacheForTests();

    const result = verifyMetaChallenge(params());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);

    // An explicitly blank token is not matchable either.
    const blank = verifyMetaChallenge(params({ "hub.verify_token": "" }), "");
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.status).toBe(503);
  });
});

describe("GET /api/meta/webhook", () => {
  function challengeRequest(overrides: Record<string, string> = {}) {
    const search = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "1158201444",
      ...overrides,
    });
    return new Request(`http://localhost/api/meta/webhook?${search}`);
  }

  it("returns the challenge as bare text, not JSON", async () => {
    const response = await GET(challengeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    const body = await response.text();
    // A JSON-quoted body would fail Meta's verification.
    expect(body).toBe("1158201444");
    expect(body).not.toContain('"');
  });

  it("returns 403 for a wrong verify token", async () => {
    const response = await GET(
      challengeRequest({ "hub.verify_token": "wrong-token-value" }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(VERIFY_TOKEN);
  });

  it("returns 503, and never echoes a challenge, when the token is unset", async () => {
    vi.stubEnv("META_VERIFY_TOKEN", undefined);
    __resetEnvCacheForTests();

    const response = await GET(challengeRequest());

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("1158201444");
    expect(body).toContain("META_VERIFY_TOKEN");
  });
});
