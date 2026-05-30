import { describe, expect, it } from "vitest";
import {
  CourseSectionSchema,
  TransferMappingSchema,
  PrereqEntrySchema,
  PrereqMapSchema,
  isTransferHeaderRow,
  validateRows,
  MAX_INVALID_RATIO,
} from "../schemas";

const validCourseSection = {
  course_prefix: "ENG",
  course_number: "111",
  course_title: "College Composition",
  credits: 3,
  crn: "70056",
  days: "M W F",
  start_time: "9:00 AM",
  end_time: "9:50 AM",
  location: "Bldg A 101",
  campus: "Main",
  mode: "in-person",
  prerequisite_courses: [],
};

const validTransferMapping = {
  cc_prefix: "ENG",
  cc_number: "111",
  cc_course: "ENG 111",
  cc_title: "College Composition",
  cc_credits: "3",
  university: "vt",
  university_name: "Virginia Tech",
  univ_course: "ENGL 1105",
  univ_title: "First-Year Writing",
  univ_credits: "3",
  notes: "",
  no_credit: false,
  is_elective: false,
};

describe("CourseSectionSchema", () => {
  it("accepts a fully populated valid row", () => {
    expect(CourseSectionSchema.safeParse(validCourseSection).success).toBe(true);
  });

  it("rejects rows missing required identity fields", () => {
    const { course_prefix: _drop, ...broken } = validCourseSection;
    void _drop;
    expect(CourseSectionSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects negative credits", () => {
    const result = CourseSectionSchema.safeParse({
      ...validCourseSection,
      credits: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown mode values", () => {
    const result = CourseSectionSchema.safeParse({
      ...validCourseSection,
      mode: "remote",
    });
    expect(result.success).toBe(false);
  });

  it("accepts zoom mode (synchronous-online distinct from async online)", () => {
    const result = CourseSectionSchema.safeParse({
      ...validCourseSection,
      mode: "zoom",
    });
    expect(result.success).toBe(true);
  });

  it("accepts TBA / empty schedule strings", () => {
    const result = CourseSectionSchema.safeParse({
      ...validCourseSection,
      days: "",
      start_time: "TBA",
      end_time: "TBA",
    });
    expect(result.success).toBe(true);
  });
});

describe("TransferMappingSchema", () => {
  it("accepts a valid mapping", () => {
    expect(TransferMappingSchema.safeParse(validTransferMapping).success).toBe(true);
  });

  it("requires university slug + name", () => {
    const result = TransferMappingSchema.safeParse({
      ...validTransferMapping,
      university: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires no_credit and is_elective to be booleans, not strings", () => {
    const result = TransferMappingSchema.safeParse({
      ...validTransferMapping,
      no_credit: "false",
    });
    expect(result.success).toBe(false);
  });
});

describe("PrereqEntrySchema / PrereqMapSchema", () => {
  it("accepts a valid prereq entry", () => {
    expect(
      PrereqEntrySchema.safeParse({
        text: "ENG 111",
        courses: ["ENG 111"],
      }).success
    ).toBe(true);
  });

  it("rejects entries where courses is not an array", () => {
    const result = PrereqEntrySchema.safeParse({
      text: "ENG 111",
      courses: "ENG 111",
    });
    expect(result.success).toBe(false);
  });

  it("PrereqMapSchema accepts a record of valid entries", () => {
    const result = PrereqMapSchema.safeParse({
      "ENG 112": { text: "ENG 111", courses: ["ENG 111"] },
      "MTH 162": { text: "MTH 161", courses: ["MTH 161"] },
    });
    expect(result.success).toBe(true);
  });
});

describe("isTransferHeaderRow", () => {
  it.each([
    [{ cc_number: "Course Number" }, true],
    [{ cc_prefix: "VCCS" }, true],
    [{ cc_prefix: "NCCCS" }, true],
    [{ cc_prefix: "SCTCS" }, true],
    [{ cc_prefix: "ENG", cc_number: "111" }, false],
  ])("classifies %j -> %s", (row, expected) => {
    expect(isTransferHeaderRow(row as Record<string, unknown>)).toBe(expected);
  });
});

describe("validateRows", () => {
  it("partitions valid and invalid rows preserving original index", () => {
    const rows: unknown[] = [
      validCourseSection,
      { ...validCourseSection, mode: "remote" },
      validCourseSection,
    ];
    const result = validateRows(rows, CourseSectionSchema, (_row, i) => `row-${i}`);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].index).toBe(1);
    expect(result.invalid[0].identity).toBe("row-1");
    expect(result.invalid[0].errors[0]).toContain("mode");
  });

  it("returns empty arrays for an empty input", () => {
    const result = validateRows([], CourseSectionSchema, () => "x");
    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([]);
  });
});

describe("MAX_INVALID_RATIO", () => {
  it("is the documented 5% threshold", () => {
    // Guards against an accidental loosening of the import-abort threshold.
    expect(MAX_INVALID_RATIO).toBe(0.05);
  });
});
