import { describe, expect, it } from "vitest";
import { isWithinHorizon, pickBestTerm } from "../terms";

// Fixed "now" so every assertion is deterministic. Maps to early-June 2026,
// matching the calendar window when the bug was discovered on prod.
const NOW = new Date(2026, 5, 1); // June 1, 2026

describe("isWithinHorizon", () => {
  it("accepts past terms regardless of how stale", () => {
    expect(isWithinHorizon("2024FA", 9, NOW)).toBe(true);
    expect(isWithinHorizon("2025SP", 9, NOW)).toBe(true);
  });

  it("accepts terms inside the 9-month window", () => {
    expect(isWithinHorizon("2026SU", 9, NOW)).toBe(true);
    expect(isWithinHorizon("2026FA", 9, NOW)).toBe(true);
    expect(isWithinHorizon("2027SP", 9, NOW)).toBe(true);
  });

  it("rejects 2027SU (≈11 months out) from June 2026", () => {
    expect(isWithinHorizon("2027SU", 9, NOW)).toBe(false);
  });

  it("rejects further-out terms", () => {
    expect(isWithinHorizon("2027FA", 9, NOW)).toBe(false);
    expect(isWithinHorizon("2028SP", 9, NOW)).toBe(false);
  });

  it("passes unknown formats unchanged (don't reject what we can't parse)", () => {
    expect(isWithinHorizon("2026WIN", 9, NOW)).toBe(true);
    expect(isWithinHorizon("", 9, NOW)).toBe(true);
  });
});

describe("pickBestTerm", () => {
  it("returns the default for empty input", () => {
    expect(pickBestTerm([], NOW)).toBe("2026SP");
  });

  // This is the bug case from prod: NH (1 college, every term has count=1).
  // Without the horizon filter, the recency tie-break picks 2027SU; with
  // it, 2027SU is filtered and the tie-break picks the latest in-horizon
  // term — 2027SP.
  it("rejects stray future-term wins when ties go on recency (NH case)", () => {
    const nhRows = [
      { state: "nh", term: "2026SP", college_count: 1 },
      { state: "nh", term: "2026SU", college_count: 1 },
      { state: "nh", term: "2026FA", college_count: 1 },
      { state: "nh", term: "2027SP", college_count: 1 },
      { state: "nh", term: "2027SU", college_count: 1 }, // the bug picked this
    ];
    expect(pickBestTerm(nhRows, NOW)).toBe("2027SP");
    expect(pickBestTerm(nhRows, NOW)).not.toBe("2027SU");
  });

  it("still prefers the term with the most colleges (no ties)", () => {
    const rows = [
      { state: "va", term: "2026SP", college_count: 5 },
      { state: "va", term: "2026FA", college_count: 23 }, // winner
      { state: "va", term: "2027SP", college_count: 8 },
    ];
    expect(pickBestTerm(rows, NOW)).toBe("2026FA");
  });

  it("falls back to the unfiltered pool when every term is far-future", () => {
    // Hypothetical state whose only scraped term is 2027SU. Better to return
    // it than the hardcoded default — the data IS there.
    const rows = [{ state: "xx", term: "2027SU", college_count: 1 }];
    expect(pickBestTerm(rows, NOW)).toBe("2027SU");
  });

  it("breaks ties by recency *within* the in-horizon set", () => {
    const rows = [
      { state: "ks", term: "2026SP", college_count: 3 },
      { state: "ks", term: "2026SU", college_count: 3 },
      { state: "ks", term: "2026FA", college_count: 3 },
      { state: "ks", term: "2027SU", college_count: 3 }, // filtered out
    ];
    expect(pickBestTerm(rows, NOW)).toBe("2026FA");
  });
});
