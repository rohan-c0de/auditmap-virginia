import { describe, it, expect } from "vitest";
import { isWafChallenge, createAcalogFetch } from "@/scripts/lib/acalog-waf-fetch";

/**
 * Guards the regression that closed PR #1465: the old per-scraper retryFetch
 * checked `res.ok`, which is TRUE for a 202, so an AWS WAF challenge (HTTP 202 +
 * empty body) was returned as if it were a legitimate empty page — a silent
 * partial scrape. isWafChallenge() must classify these as challenges so the
 * fetcher solves the token / fails loudly instead of swallowing them.
 */
describe("isWafChallenge", () => {
  it("treats HTTP 202 with an empty body as a challenge (acalog variant)", () => {
    expect(isWafChallenge(202, "")).toBe(true);
  });

  it("treats a 202 with any body as a challenge", () => {
    expect(isWafChallenge(202, "<html>anything</html>")).toBe(true);
  });

  it("treats a short 200 interstitial mentioning awswaf as a challenge (MN variant)", () => {
    expect(isWafChallenge(200, "<script>window.awswaf.solve()</script>")).toBe(
      true,
    );
  });

  it("does NOT flag a normal 200 catalog page", () => {
    const realPage =
      "<html><body>" + "x".repeat(6000) + " course descriptions</body></html>";
    expect(isWafChallenge(200, realPage)).toBe(false);
  });

  it("does NOT flag a short 200 page that merely lacks the awswaf marker", () => {
    expect(isWafChallenge(200, "<html>tiny but real</html>")).toBe(false);
  });

  it("does NOT flag 404/500 as a challenge (handled by status, not WAF path)", () => {
    expect(isWafChallenge(404, "")).toBe(false);
    expect(isWafChallenge(500, "")).toBe(false);
  });
});

describe("createAcalogFetch", () => {
  it("returns a function with the (url, label, attempts) drop-in signature", () => {
    const fetcher = createAcalogFetch({ ua: "test-agent" });
    expect(typeof fetcher).toBe("function");
    // url + label are required; attempts has a default, so arity is 2.
    expect(fetcher.length).toBe(2);
  });
});
