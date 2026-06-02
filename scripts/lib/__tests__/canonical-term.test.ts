import { describe, expect, it } from "vitest";
import {
  inferTermFromStartDates,
  resolveCanonicalTerm,
  CANONICAL_TERM,
} from "../canonical-term";

const row = (start_date: string | null) => ({ start_date });

describe("inferTermFromStartDates", () => {
  it("infers Fall from Aug-Dec start dates", () => {
    const r = inferTermFromStartDates([row("2026-08-24"), row("2026-09-02"), row("2026-12-01")]);
    expect(r.term).toBe("2026FA");
    expect(r.confidence).toBe(1);
    expect(r.dated).toBe(3);
  });

  it("infers Spring from Jan-Apr, Summer from May-Jul", () => {
    expect(inferTermFromStartDates([row("2026-01-15"), row("2026-03-01")]).term).toBe("2026SP");
    expect(inferTermFromStartDates([row("2026-06-01"), row("2026-07-10")]).term).toBe("2026SU");
  });

  it("takes the modal season when dates are mixed (sub-term outliers)", () => {
    // 4 fall, 1 stray summer -> Fall wins at 80%.
    const r = inferTermFromStartDates([
      row("2026-08-24"), row("2026-08-25"), row("2026-09-01"), row("2026-09-08"),
      row("2026-07-01"),
    ]);
    expect(r.term).toBe("2026FA");
    expect(r.confidence).toBeCloseTo(0.8, 5);
  });

  it("ignores rows without a usable date", () => {
    const r = inferTermFromStartDates([row("2026-08-24"), row(null), row(""), row("TBA")]);
    expect(r.term).toBe("2026FA");
    expect(r.dated).toBe(1);
  });

  it("returns null when no row has a date", () => {
    const r = inferTermFromStartDates([row(null), row("TBA")]);
    expect(r.term).toBeNull();
    expect(r.dated).toBe(0);
  });
});

describe("resolveCanonicalTerm", () => {
  it("passes an already-canonical stem through untouched (no date dependence)", () => {
    expect(resolveCanonicalTerm("2026FA", [])).toBe("2026FA");
    expect(resolveCanonicalTerm("2026SP", [row(null)])).toBe("2026SP");
  });

  // The real prod cases this was built for — odd stems resolved by dates.
  it.each([
    ["FL26", "2026-08-20", "2026FA"],
    ["2026FL", "2026-08-20", "2026FA"],
    ["26-FAL", "2026-08-20", "2026FA"],
    ["F26-27", "2026-08-20", "2026FA"],
    ["UG26FA", "2026-09-01", "2026FA"],
    ["226FA", "2026-08-20", "2026FA"],
    ["2026-02", "2026-06-10", "2026SU"],
    ["26-SM", "2026-06-10", "2026SU"],
    ["26-PS", "2026-06-10", "2026SU"],
    ["fall-2026", "2026-08-20", "2026FA"],
  ])("resolves odd stem %s via dates -> %s", (stem, date, expected) => {
    expect(resolveCanonicalTerm(stem, [row(date), row(date)])).toBe(expected);
  });

  it("trusts dates over a misleading filename (delta-college 26-SP holds summer)", () => {
    expect(resolveCanonicalTerm("26-SP", [row("2026-06-01"), row("2026-06-15")])).toBe("2026SU");
  });

  it("returns null (leave file alone) when confidence is too low or no dates", () => {
    expect(resolveCanonicalTerm("weird", [row(null)])).toBeNull();
    // 50/50 split is below the 60% default threshold.
    expect(resolveCanonicalTerm("ambiguous", [row("2026-08-01"), row("2026-06-01")])).toBeNull();
  });

  it("CANONICAL_TERM matches SP/SU/FA only", () => {
    expect(CANONICAL_TERM.test("2026FA")).toBe(true);
    expect(CANONICAL_TERM.test("2026WI")).toBe(false);
    expect(CANONICAL_TERM.test("FL26")).toBe(false);
  });
});
