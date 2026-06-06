import { describe, expect, it } from "vitest";
import { quickAddSubjectsForState } from "../schedule-chips";

const vocab = (prefixes: string[]) => ({
  subjects: prefixes.map((prefix) => ({ prefix })),
});

describe("quickAddSubjectsForState", () => {
  it("returns exactly the popularCourses prefixes when no vocab (no regression)", () => {
    // CA-style popularCourses: C-ID codes, ENGL duplicated.
    expect(
      quickAddSubjectsForState(null, [
        "ENGL C1000",
        "COMM C1000",
        "STAT C1000",
        "ENGL C1001",
        "PSYC C1000",
        "POLS C1000",
      ])
    ).toEqual(["ENGL", "COMM", "STAT", "PSYC", "POLS"]);
  });

  it("puts curated popularCourses prefixes first, then fills breadth from vocab", () => {
    const result = quickAddSubjectsForState(
      vocab(["BIO", "ENG", "HIS", "PSY", "CHM", "SOC"]),
      ["ENG 111", "MTH 154", "BIO 101"]
    );
    // popularCourses first (ENG, MTH, BIO), then vocab order, skipping dups.
    expect(result).toEqual(["ENG", "MTH", "BIO", "HIS", "PSY", "CHM", "SOC"]);
  });

  it("de-duplicates prefixes across both sources", () => {
    expect(
      quickAddSubjectsForState(vocab(["ENG", "BIO"]), [
        "ENG 111",
        "ENG 112",
        "BIO 101",
      ])
    ).toEqual(["ENG", "BIO"]);
  });

  it("caps the total at the limit (default 8), preserving order", () => {
    const result = quickAddSubjectsForState(
      vocab(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III"]),
      ["ENG 111", "MTH 154"]
    );
    expect(result).toHaveLength(8);
    expect(result).toEqual([
      "ENG",
      "MTH",
      "AAA",
      "BBB",
      "CCC",
      "DDD",
      "EEE",
      "FFF",
    ]);
  });

  it("respects a custom limit", () => {
    expect(
      quickAddSubjectsForState(vocab(["BIO", "HIS", "PSY"]), ["ENG 111"], 2)
    ).toEqual(["ENG", "BIO"]);
  });

  it("uppercases, trims, and ignores empty entries", () => {
    expect(quickAddSubjectsForState(vocab(["bio"]), ["eng 111", ""])).toEqual([
      "ENG",
      "BIO",
    ]);
  });
});
