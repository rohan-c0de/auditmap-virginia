import { describe, expect, it } from "vitest";
import { dedupeSections } from "../courses";
import type { CourseSection } from "../types";

function sec(over: Partial<CourseSection>): CourseSection {
  return {
    college_code: "c1",
    term: "2026SP",
    course_prefix: "HIST",
    course_number: "101",
    course_title: "US History",
    credits: 3,
    crn: "1000",
    days: "MWF",
    start_time: "9:00 AM",
    end_time: "9:50 AM",
    start_date: "",
    location: "",
    campus: "",
    mode: "in-person",
    instructor: null,
    seats_open: 5,
    seats_total: 30,
    prerequisite_text: null,
    prerequisite_courses: [],
    ...over,
  } as CourseSection;
}

describe("dedupeSections", () => {
  it("collapses a section that matched two sub-queries (prefix AND title)", () => {
    const out = dedupeSections([
      sec({ crn: "1000" }),
      sec({ crn: "1000" }), // identical identity → dropped
      sec({ crn: "2000", course_title: "World History" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.crn)).toEqual(["1000", "2000"]);
  });

  it("keeps same-CRN rows that differ by college / prefix / number", () => {
    const out = dedupeSections([
      sec({ college_code: "c1", crn: "1" }),
      sec({ college_code: "c2", crn: "1" }), // different college
      sec({ college_code: "c1", crn: "1", course_prefix: "HIS" }), // different prefix
      sec({ college_code: "c1", crn: "1", course_number: "102" }), // different number
    ]);
    expect(out).toHaveLength(4);
  });

  it("preserves the order of first occurrences", () => {
    const out = dedupeSections([
      sec({ crn: "3" }),
      sec({ crn: "1" }),
      sec({ crn: "3" }),
      sec({ crn: "2" }),
    ]);
    expect(out.map((s) => s.crn)).toEqual(["3", "1", "2"]);
  });

  it("returns empty for empty input", () => {
    expect(dedupeSections([])).toEqual([]);
  });
});
