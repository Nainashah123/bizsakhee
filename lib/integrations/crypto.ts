import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { serverEnv } from "@/lib/env";
import { err, ok, type Result } from "@/lib/result";

/**
 * Encryption for per-workspace integration tokens.
 *
 * Meta access tokens let anyone holding them read and send a business's
 * customer messages, so they are encrypted before they ever reach Postgres.
 * The database only stores ciphertext; a database dump alone is not enough to
 * impersonate a seller.
 *
 * AES-256-GCM: authenticated, so tampering is detected rather than silently
 * decrypting to garbage. A fresh 96-bit IV per encryption - never reused,
 * because IV reuse under GCM is catastrophic and leaks the key stream.
 *
 * Stored format:  v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
 * The version prefix exists so the scheme can be rotated later without
 * guessing at what an old row contains.
 */

const VERSION = "v1";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;

export class IntegrationCryptoError extends Error {}

/**
 * The configured key, or an explanation of what is wrong with it.
 *
 * A wrong-length key is rejected loudly rather than being padded or hashed
 * into shape, which would quietly weaken the cipher.
 */
export function integrationKeyStatus():
  { ok: true; key: Buffer } | { ok: false; reason: string } {
  const raw = serverEnv().INTEGRATION_ENCRYPTION_KEY;

  if (!raw) {
    return {
      ok: false,
      reason:
        "INTEGRATION_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    };
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return {
      ok: false,
      reason: "INTEGRATION_ENCRYPTION_KEY is not valid base64.",
    };
  }

  if (key.length !== KEY_BYTES) {
    return {
      ok: false,
      reason: `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    };
  }

  return { ok: true, key };
}

export function isIntegrationCryptoConfigured(): boolean {
  return integrationKeyStatus().ok;
}

function requireKey(): Buffer {
  const status = integrationKeyStatus();
  if (!status.ok) throw new IntegrationCryptoError(status.reason);
  return status.key;
}

function toB64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** Encrypts a token. Returns the versioned, self-describing string to store. */
export function encryptToken(plaintext: string): string {
  if (plaintext === "") {
    throw new IntegrationCryptoError("Refusing to encrypt an empty token.");
  }

  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [VERSION, toB64Url(iv), toB64Url(tag), toB64Url(ciphertext)].join(".");
}

/**
 * Decrypts a stored token.
 *
 * Returns a Result rather than throwing: a row that fails to decrypt usually
 * means the key was rotated or the row was tampered with, and the caller
 * should surface "reconnect this channel", not a crash.
 */
export function decryptToken(stored: string): Result<string> {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return err("upstream_error", "Stored token is not in the expected format.");
  }

  const [, ivPart, tagPart, ctPart] = parts;

  try {
    const key = requireKey();
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ctPart, "base64url");

    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      return err("upstream_error", "Stored token is malformed.");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    return ok(plaintext);
  } catch {
    // Covers both a bad key and a failed authentication tag. The distinction
    // is not exposed, because it would tell an attacker which one they got
    // right.
    return err(
      "upstream_error",
      "This channel's saved credentials could not be read. Reconnect the channel.",
    );
  }
}

/**
 * Constant-time string comparison for secrets such as the Meta verify token.
 *
 * Different lengths return false without throwing - timingSafeEqual rejects
 * mismatched buffer lengths, and letting that propagate would turn a wrong
 * guess into a 500 and leak length information through the status code.
 */
export function secretsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;

  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
