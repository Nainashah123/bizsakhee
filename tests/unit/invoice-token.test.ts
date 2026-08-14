import { describe, expect, it } from "vitest";

import {
  generateShareToken,
  hashShareToken,
  isShareTokenShape,
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_LENGTH,
  shareTokenHashesMatch,
  verifyShareToken,
} from "@/lib/tokens";

/** A fixed, well-formed token so hash expectations stay deterministic. */
const FIXED_TOKEN = "v5b1ZQ3DXczMqF390_2jj-gDDX1eMRyHrNKXRNN3GQk";

describe("share token constants", () => {
  it("encodes 32 random bytes as 43 base64url characters", () => {
    // 32 bytes -> ceil(32 / 3) * 4 = 44 base64 chars, of which the last is
    // padding; base64url drops the "=", leaving 43.
    expect(SHARE_TOKEN_BYTES).toBe(32);
    expect(SHARE_TOKEN_LENGTH).toBe(43);
    expect(FIXED_TOKEN).toHaveLength(SHARE_TOKEN_LENGTH);
  });
});

describe("generateShareToken", () => {
  it("produces a token of the declared length and shape", () => {
    const token = generateShareToken();
    expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
    expect(isShareTokenShape(token)).toBe(true);
    // base64url only: no "+", "/" or "=" may appear in a URL path segment.
    expect(token).not.toMatch(/[+/=]/);
  });

  it("never repeats a token", () => {
    // A collision would hand one customer another customer's invoice, so the
    // uniqueness of the CSPRNG output is a security property, not a nicety.
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i += 1) tokens.add(generateShareToken());
    expect(tokens.size).toBe(500);
  });

  it("does not produce the same token twice in a row", () => {
    expect(generateShareToken()).not.toBe(generateShareToken());
  });
});

describe("hashShareToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashShareToken(FIXED_TOKEN)).toBe(hashShareToken(FIXED_TOKEN));
  });

  it("matches the known SHA-256 digest of a known string", () => {
    // Independently verifiable: SHA-256("abc") is one of the FIPS 180-2 test
    // vectors, so this pins the algorithm and the lowercase-hex encoding.
    expect(hashShareToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns 64 lowercase hex characters", () => {
    // SHA-256 is 32 bytes -> 64 hex characters.
    const hash = hashShareToken(FIXED_TOKEN);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", () => {
    const a = hashShareToken(FIXED_TOKEN);
    // Flip a single character of the token.
    const b = hashShareToken(`${FIXED_TOKEN.slice(0, 42)}A`);
    expect(a).not.toBe(b);
  });

  it("is not the token itself", () => {
    // What is persisted must never be the value that grants access - a leaked
    // dump of the hashes must not yield working invoice links.
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(token).not.toContain(hash);
    // Different alphabets and lengths entirely: 43 base64url vs 64 hex.
    expect(hash.length).not.toBe(token.length);
  });
});

describe("isShareTokenShape", () => {
  it("accepts a freshly generated token", () => {
    expect(isShareTokenShape(generateShareToken())).toBe(true);
    expect(isShareTokenShape(FIXED_TOKEN)).toBe(true);
  });

  it("accepts the full base64url alphabet", () => {
    // 26 lowercase + 14 uppercase + "-" + "_" + "1" = 43 characters, covering
    // every class the base64url alphabet allows.
    const alphabet = "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMN" + "-_1";
    expect(alphabet).toHaveLength(43);
    expect(isShareTokenShape(alphabet)).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isShareTokenShape("")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isShareTokenShape("a".repeat(SHARE_TOKEN_LENGTH - 1))).toBe(false);
    expect(isShareTokenShape("a".repeat(SHARE_TOKEN_LENGTH + 1))).toBe(false);
    expect(isShareTokenShape("a".repeat(64))).toBe(false);
  });

  it("rejects standard-base64 characters that are not URL safe", () => {
    // "+" and "/" are valid base64 but not base64url; a token containing them
    // would be a sign of a wrongly encoded value, not one of ours.
    expect(isShareTokenShape(`${"a".repeat(42)}+`)).toBe(false);
    expect(isShareTokenShape(`${"a".repeat(42)}/`)).toBe(false);
    expect(isShareTokenShape(`${"a".repeat(42)}=`)).toBe(false);
  });

  it("rejects whitespace anywhere, including a trailing newline", () => {
    // A regex anchored with $ alone would let "…\n" through; this asserts it
    // does not, because a path segment with a newline must never reach the DB.
    expect(isShareTokenShape(`${"a".repeat(42)} `)).toBe(false);
    expect(isShareTokenShape(` ${"a".repeat(42)}`)).toBe(false);
    expect(isShareTokenShape(`${FIXED_TOKEN}\n`)).toBe(false);
    expect(isShareTokenShape(`${"a".repeat(21)} ${"a".repeat(21)}`)).toBe(
      false,
    );
  });

  it("rejects SQL-ish and path-traversal junk", () => {
    expect(isShareTokenShape("' OR 1=1 --")).toBe(false);
    expect(isShareTokenShape("../../etc/passwd")).toBe(false);
    expect(isShareTokenShape("%2e%2e%2f")).toBe(false);
  });
});

describe("shareTokenHashesMatch", () => {
  it("matches two identical digests", () => {
    const hash = hashShareToken(FIXED_TOKEN);
    expect(shareTokenHashesMatch(hash, hash)).toBe(true);
  });

  it("rejects two different digests of the same length", () => {
    expect(
      shareTokenHashesMatch(hashShareToken("a"), hashShareToken("b")),
    ).toBe(false);
  });

  it("returns false for different lengths WITHOUT throwing", () => {
    // node:crypto's timingSafeEqual throws on a length mismatch. If that throw
    // escaped, any short/garbage token would produce a 500 instead of a 404 -
    // and the thrown-vs-returned difference is itself a length oracle.
    expect(() => shareTokenHashesMatch("abc", "abcd")).not.toThrow();
    expect(shareTokenHashesMatch("abc", "abcd")).toBe(false);
    expect(shareTokenHashesMatch(hashShareToken(FIXED_TOKEN), "")).toBe(false);
    expect(shareTokenHashesMatch("", hashShareToken(FIXED_TOKEN))).toBe(false);
  });

  it("handles two empty strings without throwing", () => {
    expect(() => shareTokenHashesMatch("", "")).not.toThrow();
  });

  it("is case sensitive, so an uppercased digest does not match", () => {
    const hash = hashShareToken(FIXED_TOKEN);
    expect(shareTokenHashesMatch(hash, hash.toUpperCase())).toBe(false);
  });
});

describe("verifyShareToken", () => {
  it("accepts the correct token against its own hash", () => {
    const token = generateShareToken();
    expect(verifyShareToken(token, hashShareToken(token))).toBe(true);
  });

  it("rejects a different, equally well-formed token", () => {
    const stored = hashShareToken(generateShareToken());
    expect(verifyShareToken(generateShareToken(), stored)).toBe(false);
  });

  it("rejects a token that differs by a single character", () => {
    const token = FIXED_TOKEN;
    const stored = hashShareToken(token);
    const nearMiss = `${token.slice(0, 42)}${token[42] === "k" ? "j" : "k"}`;
    expect(nearMiss).not.toBe(token);
    expect(isShareTokenShape(nearMiss)).toBe(true);
    expect(verifyShareToken(nearMiss, stored)).toBe(false);
  });

  it("rejects malformed input before it can reach a lookup", () => {
    const stored = hashShareToken(FIXED_TOKEN);
    expect(verifyShareToken("", stored)).toBe(false);
    expect(verifyShareToken("a".repeat(42), stored)).toBe(false);
    expect(verifyShareToken("a".repeat(44), stored)).toBe(false);
    expect(verifyShareToken(`${"a".repeat(42)}/`, stored)).toBe(false);
    expect(verifyShareToken(`${"a".repeat(42)}+`, stored)).toBe(false);
    expect(verifyShareToken(`${FIXED_TOKEN}\n`, stored)).toBe(false);
  });

  it("rejects, without throwing, when the stored hash is the wrong length", () => {
    // Guards against a truncated or empty column value crashing the route.
    expect(() => verifyShareToken(FIXED_TOKEN, "")).not.toThrow();
    expect(verifyShareToken(FIXED_TOKEN, "")).toBe(false);
    expect(verifyShareToken(FIXED_TOKEN, "deadbeef")).toBe(false);
  });

  it("does not accept the hash being passed in place of the token", () => {
    // Belt and braces: if a caller ever confused the two columns, the shape
    // check alone must stop it - a 64-char hex digest is not a 43-char token.
    const stored = hashShareToken(FIXED_TOKEN);
    expect(verifyShareToken(stored, stored)).toBe(false);
  });
});
