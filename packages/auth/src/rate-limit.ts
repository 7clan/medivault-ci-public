/**
 * @medivault/auth — In-Memory Rate Limiter
 *
 * Simple sliding-window rate limiter with no external dependencies.
 * Tracks request counts per key and auto-cleans expired entries.
 */

// ─── Types ────────────────────────────────────────────────

/** Result of a rate-limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed within the limit */
  allowed: boolean;
  /** Milliseconds until the window resets (0 when `allowed` is true) */
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// ─── Implementation ───────────────────────────────────────

/** Cleanup interval in milliseconds */
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * In-memory sliding-window rate limiter.
 *
 * Usage:
 * ```ts
 * import { rateLimiter } from '@medivault/auth';
 * const result = rateLimiter.check('user:123', 5, 15 * 60 * 1000);
 * if (!result.allowed) { … }
 * ```
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Check whether a request identified by `key` is within the rate limit.
   *
   * @param key       - Arbitrary identifier (e.g. "login:192.168.1.1" or "setup").
   * @param maxAttempts - Maximum number of attempts allowed in the window.
   * @param windowMs  - Length of the sliding window in milliseconds.
   * @returns An object with `allowed` and `retryAfterMs`.
   */
  check(key: string, maxAttempts: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    // No existing bucket or window expired — create fresh
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    // Within window
    if (bucket.count < maxAttempts) {
      bucket.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    }

    // Rate limited
    const retryAfterMs = bucket.resetAt - now;
    return { allowed: false, retryAfterMs };
  }

  /**
   * Manually reset the bucket for a given key (e.g. after successful login).
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Remove all buckets. Useful in tests.
   */
  clearAll(): void {
    this.buckets.clear();
  }

  /**
   * Stop the cleanup timer. Call when shutting down the process.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get the number of active buckets (useful for monitoring / tests).
   */
  get size(): number {
    return this.buckets.size;
  }

  // ─── Private ────────────────────────────────────────────

  /** Start periodic cleanup of expired buckets */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (now >= bucket.resetAt) {
          this.buckets.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // Allow the process to exit even if the timer is still active
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}

// ─── Singleton & Defaults ────────────────────────────────

/** Global singleton rate limiter instance */
export const rateLimiter = new RateLimiter();

/** Default rate-limit configurations for common auth actions */
export const RATE_LIMITS = {
  /** Login attempts: 5 per 15 minutes */
  LOGIN_MAX: 5,
  LOGIN_WINDOW_MS: 15 * 60 * 1000,

  /** Initial setup attempts: 3 per 60 minutes */
  SETUP_MAX: 3,
  SETUP_WINDOW_MS: 60 * 60 * 1000,

  /** Token refresh attempts: 10 per 60 minutes */
  REFRESH_MAX: 10,
  REFRESH_WINDOW_MS: 60 * 60 * 1000,

  /** Device pairing attempts: 5 per 60 minutes */
  DEVICE_PAIR_MAX: 5,
  DEVICE_PAIR_WINDOW_MS: 60 * 60 * 1000,
} as const;
