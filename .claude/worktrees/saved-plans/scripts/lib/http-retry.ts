/**
 * http-retry.ts
 *
 * Shared fetch wrapper with retry + backoff for HTTP scrapers.
 *
 * Designed for sources that occasionally time out, return transient 5xx,
 * or rate-limit. A single retry covers ~95 % of real-world hiccups; three
 * attempts cover virtually all of them without masking sustained outages.
 *
 * Two layers of resilience the scrapers depend on:
 *   1. This helper: makes one source's transient blip recover without
 *      throwing out of the scraper.
 *   2. Per-college try/catch in the scraper's main() loop: if a source is
 *      *durably* down, that college is skipped and the scraper moves on
 *      to the others. Without this layer, the first hard failure abandons
 *      every later college, which is what issue #161 reported.
 */

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface FetchRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  /** Used in error messages for log readability. */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * `fetch` with automatic retry on transient failures (connect timeouts,
 * network resets, 408/429/5xx). Throws only after the final attempt fails.
 *
 * Returns a fully-consumable Response — callers can call `.json()` or
 * `.text()` as needed.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelay = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts.label ?? url;

  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    // Per-attempt timeout — undici's default 10s connect timeout can fire
    // mid-pagination on slow Banner servers (issue #161 — Harford CC).
    // 30s overall request timeout gives slow servers a real chance while
    // still bounding total wall-clock time across all retries.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) return res;

      if (isRetryableStatus(res.status)) {
        // Honor Retry-After if present (seconds or HTTP-date).
        let delay = baseDelay * Math.pow(2, i);
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter) {
          const asNum = Number(retryAfter);
          if (!Number.isNaN(asNum)) delay = Math.max(delay, asNum * 1000);
        }
        lastErr = new Error(`HTTP ${res.status}`);
        // Consume the body so the connection is released back to the pool.
        await res.text().catch(() => undefined);
        if (i < attempts - 1) {
          console.log(`  ${label}: HTTP ${res.status}, retry ${i + 1}/${attempts - 1} in ${delay}ms`);
          await sleep(delay);
          continue;
        }
      } else {
        // 4xx (except 408/429) is a real client error — don't retry.
        return res;
      }
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (i < attempts - 1) {
        const delay = baseDelay * Math.pow(2, i);
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ${label}: ${msg}, retry ${i + 1}/${attempts - 1} in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label}: failed after ${attempts} attempts (${reason})`);
}

/**
 * Convenience wrapper: fetchWithRetry + .json() with a single label for logs.
 */
export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {}
): Promise<T> {
  const res = await fetchWithRetry(url, init, opts);
  return res.json() as Promise<T>;
}
