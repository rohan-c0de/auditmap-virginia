import { describe, expect, it } from "vitest";
import {
  parseSubjectQueries,
  parseTimeWindow,
  combinations,
  hasTimeConflict,
  hasBreakViolation,
  isFullSection,
  scoreSeatAvailability,
  type EnrichedSection,
} from "../schedule";

function section(overrides: Partial<EnrichedSection>): EnrichedSection {
  // Minimal EnrichedSection — only fields the conflict helpers actually read.
  return {
    state: "va",
    college_code: "nvcc",
    term: "2026SP",
    course_prefix: "ENG",
    course_number: "111",
    course_title: "Comp",
    credits: 3,
    crn: "1",
    days: "M W F",
    start_time: "9:00 AM",
    end_time: "9:50 AM",
    location: "Bldg A",
    campus: "Main",
    mode: "in-person",
    prerequisite_courses: [],
    seats_open: 10,
    seats_total: 30,
    _startMin: 540,
    _endMin: 590,
    _dayMask: 0b00010101, // M W F
    _courseKey: "ENG-111",
    _distance: null,
    _collegeName: "NVCC",
    _isAsync: false,
    _transferStatus: "unknown",
    _transferCourse: "",
    ...overrides,
  } as EnrichedSection;
}

describe("parseSubjectQueries", () => {
  it("classifies exact course codes", () => {
    expect(parseSubjectQueries(["PSY 200", "ART 101"])).toEqual({
      exactCourses: ["PSY-200", "ART-101"],
      subjectPrefixes: [],
    });
  });

  it("classifies prefix-only entries", () => {
    expect(parseSubjectQueries(["BIO", "art"])).toEqual({
      exactCourses: [],
      subjectPrefixes: ["BIO", "ART"],
    });
  });

  it("treats free text as keyword search", () => {
    const result = parseSubjectQueries(["psychology"]);
    expect(result.exactCourses).toEqual([]);
    expect(result.subjectPrefixes).toEqual(["PSYCHOLOGY"]);
  });

  it("supports mixed exact + prefix input", () => {
    expect(parseSubjectQueries(["PSY 200", "BIO"])).toEqual({
      exactCourses: ["PSY-200"],
      subjectPrefixes: ["BIO"],
    });
  });

  it("normalises whitespace and handles 'PSY200' with no space", () => {
    expect(parseSubjectQueries(["psy200"])).toEqual({
      exactCourses: ["PSY-200"],
      subjectPrefixes: [],
    });
  });
});

describe("parseTimeWindow", () => {
  it("expands bucket name pairs to their combined range", () => {
    expect(parseTimeWindow("morning", "afternoon")).toEqual({
      startMin: 0,
      endMin: 1020,
    });
    expect(parseTimeWindow("morning", "evening")).toEqual({
      startMin: 0,
      endMin: 1440,
    });
  });

  it("returns the bucket alone when only the start is a bucket", () => {
    expect(parseTimeWindow("morning", "??")).toEqual({
      startMin: 0,
      endMin: 720,
    });
  });

  it("parses explicit times", () => {
    expect(parseTimeWindow("9:00 AM", "5:00 PM")).toEqual({
      startMin: 540,
      endMin: 1020,
    });
  });

  it("falls back to all-day on unparseable input", () => {
    expect(parseTimeWindow("garbage", "garbage")).toEqual({
      startMin: 0,
      endMin: 1440,
    });
  });
});

describe("combinations", () => {
  it("generates C(n, k) combinations", () => {
    expect(combinations([1, 2, 3], 2)).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });

  it("returns the array itself when k equals length", () => {
    expect(combinations([1, 2], 2)).toEqual([[1, 2]]);
  });

  it("returns empty when k exceeds length", () => {
    expect(combinations([1], 3)).toEqual([]);
  });

  it("returns [[]] when k is 0", () => {
    expect(combinations([1, 2, 3], 0)).toEqual([[]]);
  });
});

describe("hasTimeConflict", () => {
  it("detects overlap on a shared day", () => {
    const a = section({ _startMin: 540, _endMin: 600 });
    const b = section({ _startMin: 580, _endMin: 640 });
    expect(hasTimeConflict(a, b)).toBe(true);
  });

  it("non-overlapping back-to-back sections do not conflict", () => {
    const a = section({ _startMin: 540, _endMin: 600 });
    const b = section({ _startMin: 600, _endMin: 660 });
    expect(hasTimeConflict(a, b)).toBe(false);
  });

  it("different day-masks never conflict even at same time", () => {
    const a = section({ _dayMask: 0b00000001, _startMin: 540, _endMin: 600 });
    const b = section({ _dayMask: 0b00000010, _startMin: 540, _endMin: 600 });
    expect(hasTimeConflict(a, b)).toBe(false);
  });

  it("async sections never conflict", () => {
    const async1 = section({ _isAsync: true, _startMin: -1, _endMin: -1, _dayMask: 0 });
    const sync1 = section({ _startMin: 540, _endMin: 600 });
    expect(hasTimeConflict(async1, sync1)).toBe(false);
    expect(hasTimeConflict(async1, async1)).toBe(false);
  });
});

describe("hasBreakViolation", () => {
  it("flags gaps shorter than the minimum", () => {
    const a = section({ _startMin: 540, _endMin: 600 });
    const b = section({ _startMin: 605, _endMin: 660 });
    expect(hasBreakViolation(a, b, 10)).toBe(true);
  });

  it("does not flag gaps equal to or longer than the minimum", () => {
    const a = section({ _startMin: 540, _endMin: 600 });
    const b = section({ _startMin: 615, _endMin: 660 });
    expect(hasBreakViolation(a, b, 10)).toBe(false);
  });

  it("ignores async sections", () => {
    const a = section({ _isAsync: true, _startMin: -1, _endMin: -1, _dayMask: 0 });
    const b = section({ _startMin: 540, _endMin: 600 });
    expect(hasBreakViolation(a, b, 30)).toBe(false);
  });

  it("ignores different days", () => {
    const a = section({ _dayMask: 0b00000001, _startMin: 540, _endMin: 600 });
    const b = section({ _dayMask: 0b00000010, _startMin: 605, _endMin: 660 });
    expect(hasBreakViolation(a, b, 30)).toBe(false);
  });

  it("returns false when minBreakMinutes is 0", () => {
    const a = section({ _startMin: 540, _endMin: 600 });
    const b = section({ _startMin: 600, _endMin: 660 });
    expect(hasBreakViolation(a, b, 0)).toBe(false);
  });
});

describe("isFullSection (hide-full filter)", () => {
  it("treats 0 open as full", () => {
    expect(isFullSection({ seats_open: 0, seats_total: 30 })).toBe(true);
  });
  it("treats NEGATIVE open (full + waitlist) as full — the bug the old `=== 0` missed", () => {
    expect(isFullSection({ seats_open: -5, seats_total: 30 })).toBe(true);
    expect(isFullSection({ seats_open: -363, seats_total: null })).toBe(true);
  });
  it("does NOT treat open sections, sentinels, or unknown as full", () => {
    expect(isFullSection({ seats_open: 5, seats_total: 30 })).toBe(false);
    expect(isFullSection({ seats_open: 9999, seats_total: 9999 })).toBe(false); // sentinel = open
    expect(isFullSection({ seats_open: 1, seats_total: null })).toBe(false); // flag-state open
    expect(isFullSection({ seats_open: null, seats_total: null })).toBe(false); // unknown — kept
  });
});

describe("scoreSeatAvailability", () => {
  const score = (rows: { seats_open: number | null; seats_total: number | null }[]) =>
    scoreSeatAvailability(rows as Pick<EnrichedSection, "seats_open" | "seats_total">[]);

  it("a confirmed wide-open section scores the max (15)", () => {
    expect(score([{ seats_open: 25, seats_total: 30 }])).toBe(15);
  });

  it("a full section (0) scores 0", () => {
    expect(score([{ seats_open: 0, seats_total: 30 }])).toBe(0);
  });

  it("a waitlisted (negative) section scores 0, not negative — old code went below 0", () => {
    expect(score([{ seats_open: -5, seats_total: 30 }])).toBe(0);
  });

  it("a 9999 sentinel section is NOT ranked most-available (scores below a real wide-open one)", () => {
    const sentinel = score([{ seats_open: 9999, seats_total: 9999 }]);
    const wideOpen = score([{ seats_open: 25, seats_total: 30 }]);
    expect(sentinel).toBeLessThan(wideOpen);
    expect(sentinel).toBeGreaterThan(0); // still counts as available
  });

  it("real open count with a sentinel total is treated as available, not full", () => {
    // open 20, total 9999 (sentinel) → old code: fillRatio≈0 → ~0 (looked full).
    const s = score([{ seats_open: 20, seats_total: 9999 }]);
    expect(s).toBeGreaterThan(score([{ seats_open: 1, seats_total: 30 }])); // beats a nearly-full real section
  });

  it("no-data sections get a neutral mid score (unchanged)", () => {
    const neutral = score([{ seats_open: null, seats_total: null }]);
    expect(neutral).toBeGreaterThan(0);
    expect(neutral).toBeLessThan(15);
  });

  it("averages a mix of full / open-unlimited / real-count / unknown sections", () => {
    // per-section sub-scores: wide-open count 1.0, full 0, sentinel 0.75,
    // unknown 0.5 → avg 0.5625 × 15 = 8.4375 → rounded to 8.4.
    const s = score([
      { seats_open: 25, seats_total: 30 },
      { seats_open: 0, seats_total: 30 },
      { seats_open: 9999, seats_total: 9999 },
      { seats_open: null, seats_total: null },
    ]);
    expect(s).toBe(8.4);
  });
});
