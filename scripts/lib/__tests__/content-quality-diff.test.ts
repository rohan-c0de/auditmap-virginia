import { describe, it, expect } from "vitest";
import {
  measure,
  compareQuality,
  type SectionLike,
} from "../content-quality-diff";

// Build N section rows, overriding fields for a given fraction of them.
function rows(
  n: number,
  base: SectionLike,
  taint?: { count: number; over: Partial<SectionLike> }
): SectionLike[] {
  const out: SectionLike[] = [];
  for (let i = 0; i < n; i++) {
    const o = { ...base };
    if (taint && i < taint.count) Object.assign(o, taint.over);
    out.push(o);
  }
  return out;
}

const GOOD: SectionLike = {
  course_prefix: "ENG",
  course_number: "101",
  course_title: "English Composition",
  mode: "in-person",
  instructor: "Jane Smith",
};

describe("measure", () => {
  it("scores a clean catalog at 100% / 0 placeholder", () => {
    const m = measure(rows(100, GOOD));
    expect(m.rows).toBe(100);
    expect(m.titleFill).toBe(1);
    expect(m.keyFill).toBe(1);
    expect(m.modeValid).toBe(1);
    expect(m.instructorPlaceholder).toBe(0);
  });

  it("an empty array is neutral (scrape-diff owns empties)", () => {
    const m = measure([]);
    expect(m.rows).toBe(0);
    expect(m.titleFill).toBe(1);
    expect(m.instructorPlaceholder).toBe(0);
  });

  it("counts STAFF / TBA / null as instructor placeholders", () => {
    const m = measure([
      { ...GOOD, instructor: "STAFF" },
      { ...GOOD, instructor: "tba" },
      { ...GOOD, instructor: null },
      { ...GOOD, instructor: "Real Person" },
    ]);
    expect(m.instructorPlaceholder).toBeCloseTo(0.75);
  });

  it("counts a leaked mode label as invalid", () => {
    const m = measure([
      { ...GOOD, mode: "in-person" },
      { ...GOOD, mode: "Regular" }, // label leak — not in the enum
    ]);
    expect(m.modeValid).toBeCloseTo(0.5);
  });
});

describe("compareQuality — existing files flag regression from healthy", () => {
  it("flags a title collapse (parser shift blanked titles)", () => {
    const before = measure(rows(100, GOOD));
    const after = measure(rows(100, GOOD, { count: 70, over: { course_title: "" } }));
    const f = compareQuality("data/x/courses/c/2026FA.json", before, after);
    expect(f.some((x) => x.metric === "titleFill")).toBe(true);
  });

  it("flags a mode label leak (import would abort the term)", () => {
    const before = measure(rows(100, GOOD));
    const after = measure(rows(100, GOOD, { count: 40, over: { mode: "Lab Based" } }));
    const f = compareQuality("data/x/courses/c/2026FA.json", before, after);
    expect(f.some((x) => x.metric === "modeValid")).toBe(true);
  });

  it("flags an instructor-column collapse to placeholders", () => {
    const before = measure(rows(100, GOOD, { count: 20, over: { instructor: "STAFF" } }));
    const after = measure(rows(100, GOOD, { count: 96, over: { instructor: "STAFF" } }));
    const f = compareQuality("data/x/courses/c/2026FA.json", before, after);
    expect(f.some((x) => x.metric === "instructorPlaceholder")).toBe(true);
  });

  it("flags a key (prefix/number) fill regression", () => {
    const before = measure(rows(100, GOOD));
    const after = measure(rows(100, GOOD, { count: 20, over: { course_prefix: "" } }));
    const f = compareQuality("data/x/courses/c/2026FA.json", before, after);
    expect(f.some((x) => x.metric === "keyFill")).toBe(true);
  });
});

describe("compareQuality — does NOT cry wolf", () => {
  it("identical healthy before/after ⇒ no findings", () => {
    const m = measure(rows(100, GOOD));
    expect(compareQuality("f", m, m)).toEqual([]);
  });

  it("small legitimate churn stays within tolerance", () => {
    const before = measure(rows(100, GOOD));
    const after = measure(rows(100, GOOD, { count: 3, over: { course_title: "" } })); // 97%
    expect(compareQuality("f", before, after)).toEqual([]);
  });

  it("STAFF→named (placeholders shrink) is an improvement, not a finding", () => {
    const before = measure(rows(100, GOOD, { count: 60, over: { instructor: "STAFF" } }));
    const after = measure(rows(100, GOOD, { count: 10, over: { instructor: "STAFF" } }));
    expect(compareQuality("f", before, after)).toEqual([]);
  });

  it("chronically-sparse college (low but stable) is not flagged", () => {
    // mode only 80% valid on BOTH sides — not a regression, so no finding.
    const before = measure(rows(100, GOOD, { count: 20, over: { mode: "Regular" } }));
    const after = measure(rows(100, GOOD, { count: 20, over: { mode: "Regular" } }));
    expect(compareQuality("f", before, after)).toEqual([]);
  });

  it("an emptied AFTER file is left to scrape-diff (no finding here)", () => {
    const before = measure(rows(100, GOOD));
    const after = measure([]);
    expect(compareQuality("f", before, after)).toEqual([]);
  });
});

describe("compareQuality — new files judged on absolute floors", () => {
  it("flags a brand-new garbage file (most titles missing)", () => {
    const before = measure([]); // not on main
    const after = measure(rows(100, GOOD, { count: 70, over: { course_title: "" } }));
    const f = compareQuality("data/x/courses/new/2026FA.json", before, after);
    expect(f.some((x) => x.metric === "titleFill")).toBe(true);
  });

  it("accepts a brand-new healthy file", () => {
    const before = measure([]);
    const after = measure(rows(100, GOOD));
    expect(compareQuality("data/x/courses/new/2026FA.json", before, after)).toEqual([]);
  });
});
