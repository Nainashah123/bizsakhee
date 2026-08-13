/**
 * Typed result envelope used by every service and Server Action.
 * Services never throw for expected failures - they return an ActionError so
 * the UI can render a specific, non-leaking message.
 */

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "limit_reached"
  | "rate_limited"
  | "not_configured"
  | "upstream_error"
  | "unknown";

export type ActionError = {
  code: ErrorCode;
  message: string;
  /** Field-level messages keyed by form field name. */
  fieldErrors?: Record<string, string[]>;
};

export type Result<T> =
  { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): Result<never> {
  return { ok: false, error: { code, message, fieldErrors } };
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  limit_reached: 402,
  rate_limited: 429,
  not_configured: 503,
  upstream_error: 502,
  unknown: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
