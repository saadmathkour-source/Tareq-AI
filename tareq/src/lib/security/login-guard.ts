import { rateLimit } from './rate-limit.ts';

/**
 * Owner-login abuse guard.
 *
 * The owner account is the single key to every privileged action, so a password
 * guess must be bounded. Two layers, both per-process (see KNOWN_LIMITATIONS):
 *   1. A coarse fixed-window rate limit per client key (IP), to blunt a flood.
 *   2. A temporary lockout with exponential backoff after repeated *failures*,
 *      so slow, distributed guessing against one key still stalls.
 *
 * A successful login clears the failure state for that key.
 */

const MAX_FAILURES = 5;
const BASE_LOCKOUT_MS = 60_000; // 1 minute, doubling per failure past the threshold
const MAX_LOCKOUT_MS = 30 * 60_000;
const FAILURE_WINDOW_MS = 15 * 60_000;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;

interface State {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const state = new Map<string, State>();

/** Milliseconds the key must wait before another attempt (0 = allowed now). */
export function loginLockRemainingMs(key: string, now = Date.now()): number {
  const s = state.get(key);
  if (!s || s.lockedUntil <= now) return 0;
  return s.lockedUntil - now;
}

/** May this key attempt a login right now? */
export function checkLoginAllowed(key: string, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const rl = rateLimit(`login:${key}`, RATE_MAX, RATE_WINDOW_MS, now);
  if (!rl.ok) return { ok: false, retryAfterMs: rl.retryAfterMs };
  const lock = loginLockRemainingMs(key, now);
  if (lock > 0) return { ok: false, retryAfterMs: lock };
  return { ok: true, retryAfterMs: 0 };
}

/** Record a failed attempt and, past the threshold, engage backoff. */
export function recordLoginFailure(key: string, now = Date.now()): void {
  const s = state.get(key);
  const fresh = !s || now - s.firstFailureAt > FAILURE_WINDOW_MS;
  const failures = fresh ? 1 : s.failures + 1;
  const firstFailureAt = fresh ? now : s.firstFailureAt;
  let lockedUntil = 0;
  if (failures >= MAX_FAILURES) {
    const lock = Math.min(BASE_LOCKOUT_MS * 2 ** (failures - MAX_FAILURES), MAX_LOCKOUT_MS);
    lockedUntil = now + lock;
  }
  state.set(key, { failures, firstFailureAt, lockedUntil });
}

/** A successful login clears the failure history for the key. */
export function recordLoginSuccess(key: string): void {
  state.delete(key);
}

/** Test hook: forget all state. */
export function resetLoginGuard(): void {
  state.clear();
}
