/**
 * acalog-waf-fetch.ts — shared WAF-aware HTTP fetch for acalog-style catalogs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Many acalog catalog hosts now sit behind AWS WAF bot protection. A flagged
 * client gets **HTTP 202 with an empty body** (`x-amzn-waf-action: challenge`)
 * instead of the catalog HTML — a JS challenge it expects a browser to solve.
 *
 * The original per-scraper `retryFetch` (copied from scripts/de/…) checked
 * `res.ok`, which is `true` for a 202, and therefore returned the empty body as
 * if it were a legitimate "no courses" / "no prereqs" page. The result was a
 * SILENT partial scrape: list pages returned 0 coids → pagination stopped early;
 * detail pages returned "" → courses were skipped — with no error and no retry.
 * On 2026-06-21 this stripped tn prereqs 628 → 503 (slipping one course under
 * the 80% regression guard) before it was caught in PR review.
 *
 * THE FIX
 * -------
 * Treat a 202 (and the MN-variant 200 + "awswaf" interstitial) as a challenge:
 * solve it once via a headless-Chromium visit that yields an `aws-waf-token`
 * cookie, carry that cookie on subsequent plain fetches for the same origin, and
 * re-acquire if the challenge reappears. If the challenge cannot be cleared
 * within the retry budget, **throw** — a loud failure that aborts the scrape and
 * leaves existing data untouched, rather than a silent under-collection.
 *
 * Generalized from scripts/wa/scrape-catalog-prereqs.ts (same mechanism as
 * scripts/mn/…). For non-WAF hosts this behaves exactly like the old fetch and
 * never launches a browser — Chromium is only spawned when a challenge is seen.
 *
 * USAGE
 * -----
 *   import { createAcalogFetch } from "../lib/acalog-waf-fetch";
 *   const retryFetch = createAcalogFetch({ ua: UA });
 *   const html = await retryFetch(url, "list(cpage=1)");
 */

import { chromium } from "playwright";

export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-origin token cache, shared across every fetcher created in the process so
// concurrent scrapers hitting the same host don't each solve the challenge.
const wafCookies = new Map<string, string>();
const wafInFlight = new Map<string, Promise<string>>();

/**
 * True when an HTTP response is an AWS WAF challenge rather than real content.
 * Two variants seen in the wild:
 *   - acalog: HTTP 202 with an empty body
 *   - MN-style: HTTP 200 with a short interstitial containing "awswaf"
 */
export function isWafChallenge(status: number, body: string): boolean {
  if (status === 202) return true;
  return body.length < 5_000 && body.includes("awswaf");
}

/**
 * Solve the JS challenge in headless Chromium and capture the resulting cookie
 * string (including `aws-waf-token`). Deduped per origin.
 *
 * `challengeUrl` must be the actual content URL that got challenged, NOT the
 * bare origin: some WAF deployments (e.g. catalog.pstcc.edu) only issue the
 * token on a real catalog path and never on `/`. We navigate to the challenged
 * URL itself — which reliably triggers the token for every variant seen — and
 * poll for the cookie rather than waiting a fixed interval, because the
 * challenge resolves via a client-side reload that takes a variable moment.
 */
async function acquireWafCookies(
  base: string,
  challengeUrl: string,
  ua: string,
  force = false,
): Promise<string> {
  if (!force) {
    const cached = wafCookies.get(base);
    if (cached) return cached;
  }
  const inFlight = wafInFlight.get(base);
  if (inFlight) return inFlight;

  const p = (async () => {
    console.log(`  Acquiring WAF token via headless browser: ${base}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ userAgent: ua });
      const page = await ctx.newPage();
      // networkidle lets the challenge's client-side reload settle. The reload
      // can momentarily destroy the execution context, so the goto itself may
      // throw — that's fine, we poll the cookie jar below regardless.
      try {
        await page.goto(challengeUrl, {
          waitUntil: "networkidle",
          timeout: 45_000,
        });
      } catch {
        /* navigation churn during the challenge — proceed to poll */
      }
      // Poll up to ~12s for the token cookie to appear.
      let cookieStr = "";
      for (let i = 0; i < 8; i++) {
        const cookies = await ctx.cookies();
        cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        if (cookies.some((c) => c.name === "aws-waf-token")) break;
        await page.waitForTimeout(1_500);
      }
      if (!cookieStr.includes("aws-waf-token")) {
        console.log(`  ⚠ no aws-waf-token cookie acquired for ${base}`);
      }
      wafCookies.set(base, cookieStr);
      return cookieStr;
    } finally {
      await browser.close();
      wafInFlight.delete(base);
    }
  })();
  wafInFlight.set(base, p);
  return p;
}

export interface AcalogFetch {
  (url: string, label: string, attempts?: number): Promise<string>;
}

export interface AcalogFetchOptions {
  /** User-Agent for both fetch() and the Chromium challenge solve. */
  ua?: string;
  /** Default retry attempts when a call omits its own. */
  attempts?: number;
}

/**
 * Build a WAF-aware `retryFetch(url, label, attempts?)`.
 *
 * Drop-in for the old per-scraper signature `(url, label, attempts) => string`:
 *   - 2xx (non-challenge) → returns the body
 *   - 404 / other 4xx → returns "" (course delisted; skip silently — unchanged)
 *   - 5xx → retried with backoff
 *   - 202 / awswaf interstitial → solves the WAF token and retries
 *   - all attempts exhausted → THROWS (loud failure, never a silent "")
 */
export function createAcalogFetch(opts: AcalogFetchOptions = {}): AcalogFetch {
  const ua = opts.ua ?? DEFAULT_UA;
  const defaultAttempts = opts.attempts ?? 4;

  return async function retryFetch(
    url: string,
    label: string,
    attempts = defaultAttempts,
  ): Promise<string> {
    const base = new URL(url).origin;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const headers: Record<string, string> = {
          "User-Agent": ua,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${base}/`,
        };
        const cookies = wafCookies.get(base);
        if (cookies) headers["Cookie"] = cookies;

        const res = await fetch(url, { headers });
        // A 202 has an empty body; read it so the challenge check can run.
        const body = res.ok || res.status === 202 ? await res.text() : "";
        if (isWafChallenge(res.status, body)) {
          // Force re-acquire after the first miss in case the token expired.
          // Solve against the challenged URL itself — some WAFs only mint the
          // token on a real content path, not the bare origin.
          await acquireWafCookies(base, url, ua, i > 0);
          continue;
        }
        if (res.ok) return body;
        if (res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}`);
        } else {
          return ""; // 404 etc. — course probably delisted; skip silently
        }
      } catch (e) {
        lastErr = e;
      }
      await sleep(500 * Math.pow(2, i));
    }
    throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
  };
}
