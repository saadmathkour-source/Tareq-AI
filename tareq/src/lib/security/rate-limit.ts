/**
 * In-process fixed-window rate limiter.
 *
 * The public checkout and download routes are reachable by anyone, so they need
 * a cheap abuse guard. A fixed window per key is enough here: it bounds how many
 * requests one client (by IP) or one identifier (by email/order) can make in a
 * period, without any external store. It is intentionally per-process — Railway
 * runs a single service, and the limiter only needs to blunt obvious abuse
 * (scripted order floods, download brute force), not to be a global quota.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Consume one unit for `key`. Returns `ok: false` once the window's allowance is
 * spent, with `retryAfterMs` until the window resets.
 */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, retryAfterMs: 0 };
  }
  if (existing.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, existing.resetAt - now) };
  }
  existing.count += 1;
  return { ok: true, remaining: max - existing.count, retryAfterMs: 0 };
}

/** Test helper: forget all windows. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Test helper: how many keys are currently tracked (for assertions). */
export function rateLimitSize(): number {
  return buckets.size;
}
