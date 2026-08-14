import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * Meta webhook authenticity.
 *
 * Meta signs every webhook delivery with an HMAC-SHA256 of the RAW request
 * body, keyed by the app secret, in the `X-Hub-Signature-256` header as
 * `sha256=<hex>`.
 *
 * The body must be the exact bytes Meta sent. Parsing to JSON and
 * re-serialising changes key order and whitespace and will not verify, so
 * callers read `await request.text()` and pass that string here.
 */

export const SIGNATURE_HEADER = "x-hub-signature-256";

export type SignatureResult =
  | { valid: true }
  | {
      valid: false;
      reason: "not_configured" | "missing" | "malformed" | "mismatch";
    };

/**
 * Verifies a delivery.
 *
 * Fails closed in every branch: an unconfigured app secret is a rejection, not
 * a bypass, so an endpoint that is live before setup is finished cannot be fed
 * forged events.
 */
export function verifyMetaSignature(
  rawBody: string,
  headerValue: string | null | undefined,
  appSecret: string | null | undefined = serverEnv().META_APP_SECRET,
): SignatureResult {
  if (!appSecret) return { valid: false, reason: "not_configured" };
  if (!headerValue) return { valid: false, reason: "missing" };

  const [algorithm, provided] = headerValue.split("=");
  if (algorithm !== "sha256" || !provided) {
    return { valid: false, reason: "malformed" };
  }

  // A non-hex or wrong-length digest would make Buffer.from truncate silently,
  // which could compare equal to a short expected value.
  if (!/^[0-9a-f]{64}$/i.test(provided)) {
    return { valid: false, reason: "malformed" };
  }

  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest();
  const actual = Buffer.from(provided, "hex");

  if (expected.length !== actual.length) {
    return { valid: false, reason: "mismatch" };
  }

  return timingSafeEqual(expected, actual)
    ? { valid: true }
    : { valid: false, reason: "mismatch" };
}

/**
 * The GET handshake Meta performs when a webhook URL is first configured.
 *
 * Meta sends hub.mode=subscribe, hub.verify_token and hub.challenge; we echo
 * the challenge back only when the token matches the one we configured.
 */
export type ChallengeResult =
  | { ok: true; challenge: string }
  | { ok: false; status: 403 | 503; reason: string };

export function verifyMetaChallenge(
  params: URLSearchParams,
  configuredToken: string | null | undefined = serverEnv().META_VERIFY_TOKEN,
): ChallengeResult {
  if (!configuredToken) {
    return {
      ok: false,
      status: 503,
      reason: "META_VERIFY_TOKEN is not configured.",
    };
  }

  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return {
      ok: false,
      status: 403,
      reason: "Malformed verification request.",
    };
  }

  const provided = Buffer.from(token, "utf8");
  const expected = Buffer.from(configuredToken, "utf8");

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { ok: false, status: 403, reason: "Verification token mismatch." };
  }

  return { ok: true, challenge };
}
