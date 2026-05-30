/**
 * Simple in-memory rate limiter.
 * Uses a sliding window approach — tracks request timestamps per key.
 */

const store = new Map<string, number[]>();

const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL = 5 * 60_000; // clean stale entries every 5 min

// Periodic cleanup to prevent memory leaks
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store) {
      const valid = timestamps.filter((t) => now - t < WINDOW_MS);
      if (valid.length === 0) {
        store.delete(key);
      } else {
        store.set(key, valid);
      }
    }
  }, CLEANUP_INTERVAL);
  // Don't block process exit
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Check if a request should be allowed.
 * Operates synchronously on the store to avoid race conditions —
 * the filter→check→push→set sequence completes in a single microtask.
 * @returns `true` if allowed, `false` if rate-limited.
 */
export function rateLimit(
  key: string,
  maxRequests: number = 30
): { allowed: boolean; remaining: number } {
  ensureCleanup();

  const now = Date.now();
  const existing = store.get(key);
  // Filter expired timestamps, then immediately decide and update in one step
  const valid = existing ? existing.filter((t) => now - t < WINDOW_MS) : [];

  if (valid.length >= maxRequests) {
    store.set(key, valid);
    return { allowed: false, remaining: 0 };
  }

  // Commit the new timestamp before returning — prevents interleaving
  valid.push(now);
  store.set(key, valid);
  return { allowed: true, remaining: maxRequests - valid.length };
}

/**
 * Extract a rate-limit key from a request (uses IP or forwarded-for header).
 */
export function getClientKey(request: Request): string {
  // On Vercel/Cloudflare, x-forwarded-for is set by the proxy and cannot be spoofed.
  // In direct-access deployments, this header IS spoofable.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  // Fallback: use user-agent to avoid single shared bucket
  return `anon-${request.headers.get("user-agent")?.slice(0, 50) || "unknown"}`;
}
