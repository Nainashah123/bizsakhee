/**
 * Token encryption at rest.
 *
 * A Meta access token can read and send a seller's customer messages, so these
 * tests care as much about the failure modes - tampering, a rotated key, a
 * malformed row - as about the happy path.
 *
 * @vitest-environment node
 */

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __resetEnvCacheForTests } from "@/lib/env";
import {
  decryptToken,
  encryptToken,
  integrationKeyStatus,
  isIntegrationCryptoConfigured,
  secretsMatch,
} from "@/lib/integrations/crypto";

/** 32 bytes, base64 - exactly what `openssl rand -base64 32` produces. */
const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

const TOKEN = "EAAG9ZC1exampleAccessTokenValue0123456789";

/**
 * Changes the FIRST character of a base64url component.
 *
 * Not the last: a 16-byte tag encodes to 22 base64url characters, four bits
 * wider than the data, so several trailing characters decode to identical
 * bytes. Flipping the last one would sometimes not be a tamper at all.
 */
function tamper(component: string): string {
  const replacement = component[0] === "A" ? "B" : "A";
  return `${replacement}${component.slice(1)}`;
}

function useKey(value: string | undefined) {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", value);
  __resetEnvCacheForTests();
}

beforeEach(() => {
  useKey(KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a token", () => {
    const stored = encryptToken(TOKEN);

    expect(stored).not.toContain(TOKEN);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.split(".")).toHaveLength(4);

    const result = decryptToken(stored);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(TOKEN);
  });

  it("round-trips unicode and long values", () => {
    for (const value of ["नमस्ते-टोकन", "x".repeat(4000), "a"]) {
      const result = decryptToken(encryptToken(value));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(value);
    }
  });

  it("produces different ciphertext each time for the same plaintext", () => {
    const first = encryptToken(TOKEN);
    const second = encryptToken(TOKEN);

    // A fresh IV per encryption. Reuse under GCM leaks the key stream, so this
    // is not a cosmetic property.
    expect(first).not.toBe(second);

    const [, ivA, tagA, ctA] = first.split(".");
    const [, ivB, tagB, ctB] = second.split(".");
    expect(ivA).not.toBe(ivB);
    expect(tagA).not.toBe(tagB);
    expect(ctA).not.toBe(ctB);

    // Both still decrypt to the same token.
    const a = decryptToken(first);
    const b = decryptToken(second);
    expect(a.ok && b.ok && a.data === b.data).toBe(true);
  });

  it("refuses to encrypt an empty token", () => {
    expect(() => encryptToken("")).toThrow();
  });

  it("returns an error - never throws - for a tampered ciphertext", () => {
    const [version, iv, tag, ciphertext] = encryptToken(TOKEN).split(".");
    const stored = [version, iv, tag, tamper(ciphertext)].join(".");

    expect(() => decryptToken(stored)).not.toThrow();
    const result = decryptToken(stored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("upstream_error");
      // The message tells the seller what to do and nothing about the key.
      expect(result.error.message.toLowerCase()).toContain("reconnect");
      expect(result.error.message).not.toContain(TOKEN);
    }
  });

  it("returns an error for a tampered authentication tag", () => {
    const [version, iv, tag, ciphertext] = encryptToken(TOKEN).split(".");

    const result = decryptToken(
      [version, iv, tamper(tag), ciphertext].join("."),
    );
    expect(result.ok).toBe(false);
  });

  it("returns an error for a tampered IV", () => {
    const [version, iv, tag, ciphertext] = encryptToken(TOKEN).split(".");

    const result = decryptToken(
      [version, tamper(iv), tag, ciphertext].join("."),
    );
    expect(result.ok).toBe(false);
  });

  it("cannot be decrypted with a different key", () => {
    const stored = encryptToken(TOKEN);

    useKey(OTHER_KEY);
    const result = decryptToken(stored);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("upstream_error");
  });

  it("returns an error for a malformed stored string", () => {
    const malformed = [
      "",
      "not-a-token",
      "v1.only.three",
      "v1.a.b.c.d",
      "v2.aaa.bbb.ccc",
      `v1..${"a".repeat(22)}.${"b".repeat(10)}`,
      // Right shape, wrong component lengths: a 4-byte IV and an 8-byte tag.
      `v1.${Buffer.alloc(4).toString("base64url")}.${Buffer.alloc(8).toString("base64url")}.${Buffer.alloc(16).toString("base64url")}`,
    ];

    for (const stored of malformed) {
      expect(() => decryptToken(stored)).not.toThrow();
      expect(decryptToken(stored).ok).toBe(false);
    }
  });

  it("reports an unusable key instead of silently weakening the cipher", () => {
    useKey(undefined);
    expect(isIntegrationCryptoConfigured()).toBe(false);
    expect(integrationKeyStatus().ok).toBe(false);
    // Encryption fails closed rather than storing plaintext.
    expect(() => encryptToken(TOKEN)).toThrow();

    // A key of the wrong length is rejected, not padded or hashed into shape.
    useKey(randomBytes(16).toString("base64"));
    const status = integrationKeyStatus();
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.reason).toContain("32 bytes");
    expect(() => encryptToken(TOKEN)).toThrow();
  });
});

describe("secretsMatch", () => {
  it("accepts identical secrets", () => {
    expect(secretsMatch(TOKEN, TOKEN)).toBe(true);
    expect(secretsMatch("नमस्ते", "नमस्ते")).toBe(true);
  });

  it("is false for different lengths without throwing", () => {
    // node's timingSafeEqual throws on a length mismatch; letting that escape
    // would turn a wrong guess into a 500 and leak the length.
    expect(() => secretsMatch("short", TOKEN)).not.toThrow();
    expect(secretsMatch("short", TOKEN)).toBe(false);
    expect(secretsMatch(`${TOKEN}extra`, TOKEN)).toBe(false);
    expect(secretsMatch("x".repeat(100_000), TOKEN)).toBe(false);
  });

  it("is false for a same-length near miss", () => {
    const nearMiss = `${TOKEN.slice(0, -1)}${TOKEN.endsWith("9") ? "8" : "9"}`;
    expect(nearMiss).toHaveLength(TOKEN.length);
    expect(secretsMatch(nearMiss, TOKEN)).toBe(false);
  });

  it("is false for empty or absent values, in either position", () => {
    for (const value of [null, undefined, ""]) {
      expect(secretsMatch(value, TOKEN)).toBe(false);
      expect(secretsMatch(TOKEN, value)).toBe(false);
      expect(secretsMatch(value, value)).toBe(false);
    }
  });
});
