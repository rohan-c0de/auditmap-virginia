import { describe, expect, it } from "vitest";
import {
  isRealCourse,
  countRealCourses,
  programSlug,
  PLAN_MIN_COURSES,
} from "../plan-shared";
import type { RequirementGroup } from "@/lib/types";

describe("isRealCourse", () => {
  it("accepts a normal course code", () => {
    expect(isRealCourse({ prefix: "MGMT", number: "1100" })).toBe(true);
    expect(isRealCourse({ prefix: "BIO", number: "101LAB" })).toBe(true);
  });

  it("rejects XXX placeholders in either field", () => {
    expect(isRealCourse({ prefix: "ELEC", number: "XXX" })).toBe(false);
    expect(isRealCourse({ prefix: "XXX", number: "100" })).toBe(false);
    expect(isRealCourse({ prefix: "MGNT", number: "0XXX" })).toBe(false);
  });

  it("rejects a number with no digit (label, not a course)", () => {
    expect(isRealCourse({ prefix: "ELEC", number: "Elective" })).toBe(false);
    expect(isRealCourse({ prefix: "HUM", number: "" })).toBe(false);
  });
});

describe("countRealCourses", () => {
  const groups = (courses: Array<{ prefix: string; number: string }>): RequirementGroup[] => [
    {
      name: "G",
      credits_required: null,
      choose_n: null,
      courses: courses.map((c) => ({ ...c, title: "", credits: null, or_alternatives: [] })),
    },
  ];

  it("counts only real courses across groups", () => {
    const p = {
      requirement_groups: [
        ...groups([
          { prefix: "MGMT", number: "1100" },
          { prefix: "ELEC", number: "XXX" },
        ]),
        ...groups([{ prefix: "ACCT", number: "2101" }]),
      ],
    };
    expect(countRealCourses(p)).toBe(2);
  });

  it("returns 0 for an all-placeholder program (the NJ failure mode)", () => {
    const p = { requirement_groups: groups([{ prefix: "ELEC", number: "XXX" }]) };
    expect(countRealCourses(p)).toBe(0);
  });
});

describe("programSlug", () => {
  it("produces a stable, URL-safe slug from title + credential", () => {
    expect(programSlug({ title: "Business Management AAS", credential: "AS" })).toBe(
      "business-management-aas-as",
    );
    expect(programSlug({ title: "Nursing", credential: "AAS" })).toBe("nursing-aas");
  });

  it("collapses punctuation and trims separators", () => {
    expect(
      programSlug({ title: "Accounting for Forensic Accounting", credential: "AS" }),
    ).toBe("accounting-for-forensic-accounting-as");
    expect(programSlug({ title: "  A/B & C!  ", credential: "other" })).toBe("a-b-c-other");
  });
});

describe("PLAN_MIN_COURSES", () => {
  it("is a sane gate", () => {
    expect(PLAN_MIN_COURSES).toBeGreaterThanOrEqual(3);
  });
});
