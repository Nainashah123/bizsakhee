import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Share tokens for public invoice links.
 *
 * The raw token exists only in the URL the owner copies. The database stores a
 * SHA-256 hash of it, so a leaked database dump does not hand out working
 * invoice links, and a lookup hashes the incoming token before matching.
 *
 * SHA-256 without a salt is deliberate: the token is 256 bits of CSPRNG output,
 * so it is not guessable or rainbow-table-able, and an unsalted digest is what
 * makes a single indexed equality lookup possible.
 *
 * Node.js runtime only - `node:crypto` is not available on the Edge runtime.
 */

/** 32 random bytes, base64url encoded: 43 URL-safe characters. */
export const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/** Lowercase hex SHA-256 digest of the raw token. This is what is persisted. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Cheap shape check so an obviously malformed path segment never reaches the
 * database. Returning false here is equivalent to "no such invoice".
 */
export function isShareTokenShape(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The database lookup already matches on the hash; this second check guards the
 * comparison we perform ourselves, so a caller can never learn how much of a
 * candidate digest was correct from response timing.
 */
export function shareTokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare against a same-length buffer and fold the result in.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Hashes a candidate token and compares it to a stored hash in constant time. */
export function verifyShareToken(token: string, storedHash: string): boolean {
  if (!isShareTokenShape(token)) return false;
  return shareTokenHashesMatch(hashShareToken(token), storedHash);
}
