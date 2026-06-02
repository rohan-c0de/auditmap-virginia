import { describe, expect, it } from "vitest";
import {
  inferTermFromStartDates,
  resolveCanonicalTerm,
  buildImportUnits,
  CANONICAL_TERM,
  type RawTermFile,
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

const sec = (crn: string, start_date: string | null = "2026-08-20") => ({ crn, start_date });

describe("buildImportUnits", () => {
  // ---- Safety invariant: colleges with ANY canonical term are untouched ----

  it("a canonical-only college gets one unit per file, term=stem, no rewriting", () => {
    const files: RawTermFile[] = [
      { stem: "2026FA", sections: [sec("100"), sec("101")] },
      { stem: "2026SU", sections: [sec("200")] },
    ];
    const units = buildImportUnits(files);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.term)).toEqual(["2026FA", "2026SU"]);
    expect(units.every((u) => u.canonicalized === false)).toBe(true);
    // Same row arrays, untouched.
    expect(units[0].sections).toHaveLength(2);
    expect(units[1].sections).toHaveLength(1);
  });

  it("does NOT touch non-canonical files when a canonical one is present (WA 2027WI case)", () => {
    // WA: canonical FA/SU/SP + a winter file. Winter must pass through under
    // its raw stem, NOT be folded into 2027SP — that would clobber real spring.
    const files: RawTermFile[] = [
      { stem: "2026FA", sections: [sec("1")] },
      { stem: "2027SP", sections: [sec("2", "2027-04-01")] },
      { stem: "2027WI", sections: [sec("3", "2027-01-05")] }, // Jan dates -> would infer SP
    ];
    const units = buildImportUnits(files);
    const byTerm = Object.fromEntries(units.map((u) => [u.term, u]));
    expect(units).toHaveLength(3);
    expect(byTerm["2027WI"]).toBeDefined();
    expect(byTerm["2027WI"].canonicalized).toBe(false);
    expect(byTerm["2027SP"].sections).toHaveLength(1); // not merged with winter
  });

  // ---- Fully-invisible colleges (no canonical file) get canonicalized ----

  it("canonicalizes every file for a fully-invisible college", () => {
    const files: RawTermFile[] = [
      { stem: "FL26", sections: [sec("1", "2026-08-20")] },
      { stem: "SU26", sections: [sec("2", "2026-06-10")] },
    ];
    const units = buildImportUnits(files);
    const terms = units.map((u) => u.term).sort();
    expect(terms).toEqual(["2026FA", "2026SU"]);
    expect(units.every((u) => u.canonicalized)).toBe(true);
    // rows carry through
    expect(units.find((u) => u.term === "2026FA")!.sections).toHaveLength(1);
  });

  it("merges files that resolve to the same term and dedups by CRN (schoolcraft case)", () => {
    const files: RawTermFile[] = [
      { stem: "2026-02", sections: [sec("A", "2026-06-01"), sec("B", "2026-06-02")] },
      { stem: "2026-03", sections: [sec("B", "2026-06-15"), sec("C", "2026-07-01")] }, // B dup
      { stem: "2026-04", sections: [sec("D", "2026-09-01")] },
    ];
    const units = buildImportUnits(files);
    const su = units.find((u) => u.term === "2026SU")!;
    const fa = units.find((u) => u.term === "2026FA")!;
    expect(su.sections.map((s) => (s as { crn: string }).crn).sort()).toEqual(["A", "B", "C"]); // B deduped
    expect(fa.sections).toHaveLength(1);
  });

  it("keeps an unresolvable file under its raw stem (never lost, never guessed)", () => {
    const files: RawTermFile[] = [
      { stem: "FL26", sections: [sec("1", "2026-08-20")] },
      { stem: "WEIRD", sections: [sec("2", null), sec("3", "TBA")] }, // no dates
    ];
    const units = buildImportUnits(files);
    const byTerm = Object.fromEntries(units.map((u) => [u.term, u]));
    expect(byTerm["2026FA"]).toBeDefined();
    expect(byTerm["WEIRD"]).toBeDefined(); // preserved
    expect(byTerm["WEIRD"].canonicalized).toBe(false);
    expect(byTerm["WEIRD"].sections).toHaveLength(2);
  });

  it("does not collapse CRN-less rows together", () => {
    const files: RawTermFile[] = [
      { stem: "FL26", sections: [
        { start_date: "2026-08-20" }, // no crn
        { start_date: "2026-08-21" }, // no crn
      ] },
    ];
    const units = buildImportUnits(files);
    expect(units[0].term).toBe("2026FA");
    expect(units[0].sections).toHaveLength(2); // both kept
  });

  it("handles an empty college", () => {
    expect(buildImportUnits([])).toEqual([]);
  });
});
