/**
 * Cron request authorisation.
 *
 * Scheduled invocations have no user session, so the only thing standing
 * between the reminders endpoint and the open internet is `CRON_SECRET`.
 * Three rules follow from that:
 *
 *   1. A missing secret is never treated as "no check required" - the endpoint
 *      reports `not_configured` and refuses to run.
 *   2. The comparison is timing-safe, including for inputs of a different
 *      length, which `crypto.timingSafeEqual` throws on if handed directly.
 *   3. Nothing here logs, returns or embeds the secret or the presented token.
 *
 * Pure functions with no Next.js or Supabase imports, so they are testable
 * without a request.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthStatus = "authorized" | "unauthorized" | "not_configured";

export type CronAuthResult = {
  status: CronAuthStatus;
  /** Safe to return in a response body: never mentions the secret. */
  reason: string;
};

/**
 * Constant-time string comparison.
 *
 * Both inputs are hashed first so `timingSafeEqual` always receives two 32-byte
 * buffers - a length mismatch can therefore neither throw nor leak the secret's
 * length through an early return. The explicit length check afterwards is
 * belt-and-braces against a (practically impossible) digest collision and runs
 * only after the constant-time comparison has completed.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  const digestsMatch = timingSafeEqual(digestA, digestB);
  return digestsMatch && a.length === b.length;
}

/**
 * Pulls the token out of an `Authorization: Bearer <token>` header. The scheme
 * is matched case-insensitively because proxies rewrite its casing.
 */
export function extractBearerToken(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  // (\S+) rather than (.+?): a bearer credential never contains whitespace, so
  // "Bearer    " must be rejected outright instead of yielding a blank token.
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Decides whether a cron request may proceed.
 *
 * The "is it configured at all?" question is answered first and independently
 * of the presented header, so an unset secret can never authorise a request no
 * matter what the caller sends.
 */
export function authorizeCronRequest(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): CronAuthResult {
  const configured = typeof secret === "string" ? secret.trim() : "";
  if (configured.length === 0) {
    return {
      status: "not_configured",
      reason:
        "CRON_SECRET is not set, so this endpoint cannot verify that a request came from the scheduler.",
    };
  }

  const token = extractBearerToken(authorizationHeader);
  if (token === null) {
    return {
      status: "unauthorized",
      reason: "Missing or malformed Authorization: Bearer header.",
    };
  }

  if (!timingSafeEqualStrings(token, configured)) {
    return { status: "unauthorized", reason: "Invalid credentials." };
  }

  return { status: "authorized", reason: "Authorized." };
}
