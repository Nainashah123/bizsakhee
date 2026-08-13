/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line so Vercel log drains stay queryable without a
 * paid dependency. Values are redacted by key name to keep secrets and customer
 * message bodies out of logs.
 */

type Level = "debug" | "info" | "warn" | "error";

const REDACT_PATTERN =
  /(secret|token|password|api[_-]?key|authorization|signature|cookie)/i;

const MAX_STRING = 500;

function redact(value: unknown, key?: string): unknown {
  if (key && REDACT_PATTERN.test(key)) return "[redacted]";
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}...[truncated]`
      : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        redact(v, k),
      ]),
    );
  }
  return value;
}

function write(
  level: Level,
  message: string,
  context?: Record<string, unknown>,
) {
  const line = JSON.stringify({
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
    time: new Date().toISOString(),
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") write("debug", message, context);
  },
  info: (message: string, context?: Record<string, unknown>) =>
    write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    write("error", message, context),
};
