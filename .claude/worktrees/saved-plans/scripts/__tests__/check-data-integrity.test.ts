import { describe, it, expect } from "vitest";
import {
  buildCourseSet,
  findDuplicateCrns,
  findOrphanPrereqs,
  findOrphanTransferMappings,
} from "../check-data-integrity";

describe("buildCourseSet", () => {
  it("returns 'PREFIX NUMBER' keys for every section", () => {
    const set = buildCourseSet([
      { course_prefix: "ENG", course_number: "111", crn: "1" },
      { course_prefix: "MTH", course_number: "161", crn: "2" },
    ]);
    expect(set.has("ENG 111")).toBe(true);
    expect(set.has("MTH 161")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("deduplicates the same course offered multiple times", () => {
    const set = buildCourseSet([
      { course_prefix: "ENG", course_number: "111", crn: "1" },
      { course_prefix: "ENG", course_number: "111", crn: "2" },
      { course_prefix: "ENG", course_number: "111", crn: "3" },
    ]);
    expect(set.size).toBe(1);
  });

  it("skips rows missing prefix or number", () => {
    const set = buildCourseSet([
      { course_prefix: "", course_number: "111", crn: "1" },
      { course_prefix: "ENG", course_number: "", crn: "2" },
      { course_prefix: "ENG", course_number: "111", crn: "3" },
    ]);
    expect(set.size).toBe(1);
  });
});

describe("findDuplicateCrns", () => {
  it("returns empty when every CRN is unique", () => {
    const dups = findDuplicateCrns([
      { course_prefix: "ENG", course_number: "111", crn: "1" },
      { course_prefix: "ENG", course_number: "111", crn: "2" },
    ]);
    expect(dups).toEqual([]);
  });

  it("reports a CRN that appears twice with count 2", () => {
    const dups = findDuplicateCrns([
      { course_prefix: "ENG", course_number: "111", crn: "70056" },
      { course_prefix: "ENG", course_number: "111", crn: "70056" },
    ]);
    expect(dups).toEqual([{ crn: "70056", count: 2 }]);
  });

  it("reports separate counts for separate duplicate CRNs", () => {
    const dups = findDuplicateCrns([
      { course_prefix: "ENG", course_number: "111", crn: "A" },
      { course_prefix: "ENG", course_number: "111", crn: "A" },
      { course_prefix: "ENG", course_number: "111", crn: "A" },
      { course_prefix: "ENG", course_number: "111", crn: "B" },
      { course_prefix: "ENG", course_number: "111", crn: "B" },
      { course_prefix: "ENG", course_number: "111", crn: "C" },
    ]);
    expect(dups).toEqual(
      expect.arrayContaining([
        { crn: "A", count: 3 },
        { crn: "B", count: 2 },
      ])
    );
    expect(dups.find((d) => d.crn === "C")).toBeUndefined();
  });

  it("ignores rows with empty CRN", () => {
    const dups = findDuplicateCrns([
      { course_prefix: "ENG", course_number: "111", crn: "" },
      { course_prefix: "ENG", course_number: "111", crn: "" },
    ]);
    expect(dups).toEqual([]);
  });
});

describe("findOrphanPrereqs", () => {
  const courseSet = new Set(["ENG 111", "MTH 161", "BIO 101"]);

  it("flags a key whose course is not in the catalog", () => {
    const { orphanKeys, orphanRefs } = findOrphanPrereqs(
      { "ENG 999": { text: "ENG 111", courses: ["ENG 111"] } },
      courseSet
    );
    expect(orphanKeys).toEqual(["ENG 999"]);
    expect(orphanRefs).toEqual([]);
  });

  it("flags a reference to a course not in the catalog", () => {
    const { orphanKeys, orphanRefs } = findOrphanPrereqs(
      { "ENG 111": { text: "RDG 100", courses: ["RDG 100"] } },
      courseSet
    );
    expect(orphanKeys).toEqual([]);
    expect(orphanRefs).toEqual([{ from: "ENG 111", to: "RDG 100" }]);
  });

  it("does not flag entries fully contained in the catalog", () => {
    const result = findOrphanPrereqs(
      { "MTH 161": { text: "ENG 111", courses: ["ENG 111"] } },
      courseSet
    );
    expect(result.orphanKeys).toEqual([]);
    expect(result.orphanRefs).toEqual([]);
  });

  it("handles multiple referenced courses per entry", () => {
    const { orphanRefs } = findOrphanPrereqs(
      {
        "BIO 101": {
          text: "ENG 111 and RDG 100",
          courses: ["ENG 111", "RDG 100", "MTH 161"],
        },
      },
      courseSet
    );
    expect(orphanRefs).toEqual([{ from: "BIO 101", to: "RDG 100" }]);
  });
});

describe("findOrphanTransferMappings", () => {
  const courseSet = new Set(["ENG 111", "MTH 161"]);

  it("returns empty when every CC course is in the catalog", () => {
    const orphans = findOrphanTransferMappings(
      [
        { cc_prefix: "ENG", cc_number: "111" },
        { cc_prefix: "MTH", cc_number: "161" },
      ],
      courseSet
    );
    expect(orphans).toEqual([]);
  });

  it("flags rows whose CC course is missing from the catalog", () => {
    const orphans = findOrphanTransferMappings(
      [
        { cc_prefix: "ENG", cc_number: "111" }, // present
        { cc_prefix: "VCCS", cc_number: "Course Number" }, // legitimate header row
        { cc_prefix: "ACC", cc_number: "111" }, // not in catalog
      ],
      courseSet
    );
    expect(orphans).toHaveLength(2);
  });

  it("ignores rows missing prefix or number rather than treating them as orphans", () => {
    const orphans = findOrphanTransferMappings(
      [
        { cc_prefix: "", cc_number: "111" },
        { cc_prefix: "ENG", cc_number: "" },
      ],
      courseSet
    );
    expect(orphans).toEqual([]);
  });
});
