/**
 * Fixed-window rate limiter.
 *
 * Deliberately dependency-free and in-process: it protects a single serverless
 * instance and is a speed bump, not a distributed quota. Plan limits and usage
 * counters live in Postgres (`consume_usage`) precisely because those must be
 * exact across instances. If a shared limiter is needed later, swap the store
 * behind this same interface.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Unix ms at which the current window resets. */
  resetAt: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounded so a flood of distinct keys cannot grow the map without limit.
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (limit <= 0) {
    return { allowed: false, remaining: 0, resetAt: now + windowMs };
  }

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Test-only. */
export function __resetRateLimits(): void {
  buckets.clear();
}

export const RATE_LIMITS = {
  /** Sign-in and password reset attempts, per email or IP. */
  auth: { limit: 8, windowMs: 15 * 60 * 1000 },
  /** AI generations, per user. Plan quotas are enforced separately in SQL. */
  ai: { limit: 20, windowMs: 60 * 1000 },
  /** Public catalogue enquiry and invoice lookups, per IP. */
  publicRead: { limit: 120, windowMs: 60 * 1000 },
} as const;
