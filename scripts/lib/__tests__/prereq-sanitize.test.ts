import { describe, expect, it } from "vitest";
import {
  extractCourseCodes,
  hasMarkup,
  sanitizeCourseList,
  sanitizePrereqEntry,
  sanitizePrereqText,
} from "../prereq-sanitize";

describe("sanitizePrereqText", () => {
  it("converts NC's ',<br>' separators to '; ' (verbatim BTB 103 fixture)", () => {
    // data/nc/prereqs.json "BTB 103" as re-contaminated by the 2026-06-10
    // prereqs cron tick — the case PR #973 fixed in data only.
    const raw =
      "Take BTB-102 - Must be taken either prior to or at the same time as this course.,<br>Take BTB-101 - Must be completed prior to taking this course.";
    expect(sanitizePrereqText(raw)).toBe(
      "Take BTB-102 - Must be taken either prior to or at the same time as this course; Take BTB-101 - Must be completed prior to taking this course.",
    );
  });

  it("strips NY's <p>/<u> change-log markup and decodes &amp;", () => {
    const raw =
      "<p>This revision lowers the prerequisite for this course from ACC 222 to ACC 122. ACC 122 is an appropriate prerequisite for the Government &amp; Not-for-Profit course.</p>";
    const clean = sanitizePrereqText(raw);
    expect(clean).not.toMatch(/[<>]/);
    expect(clean).toContain("Government & Not-for-Profit");
  });

  it("decodes double-encoded &amp;nbsp;", () => {
    expect(sanitizePrereqText("MATH&amp;nbsp;141 min 2.0")).toBe(
      "MATH 141 min 2.0",
    );
  });

  it("leaves plain text untouched", () => {
    const plain = "ACCT 101 with a C or better, or entry code";
    expect(sanitizePrereqText(plain)).toBe(plain);
  });
});

describe("extractCourseCodes", () => {
  it("mines hyphenated NC codes into 'PREFIX NUMBER' form", () => {
    expect(
      extractCourseCodes(
        "Take BTB-102 - Must be taken either prior to or at the same time as this course; Take BTB-101 - Must be completed prior to taking this course.",
      ),
    ).toEqual(["BTB 101", "BTB 102"]);
  });

  it("handles space-run lists and excludes term stamps", () => {
    expect(
      extractCourseCodes("Take PHM-110 PHM-111; effective FALL 2023"),
    ).toEqual(["PHM 110", "PHM 111"]);
  });
});

describe("sanitizeCourseList", () => {
  it("drops NY's effective-term tokens but keeps real codes", () => {
    expect(sanitizeCourseList(["FALL 2023", "FEB 2024", "ACC 122"])).toEqual([
      "ACC 122",
    ]);
  });

  it("keeps May-prefixed real codes intact (only MONTH+YEAR shapes drop)", () => {
    expect(sanitizeCourseList(["MAY 150", "MAY 2024"])).toEqual(["MAY 150"]);
  });
});

describe("sanitizePrereqEntry", () => {
  it("re-mines courses[] when markup was present (NC entries had empty arrays)", () => {
    const { text, courses } = sanitizePrereqEntry(
      "Take BTB-102 - Must be taken either prior to or at the same time as this course.,<br>Take BTB-101 - Must be completed prior to taking this course.",
      [],
    );
    expect(text).not.toMatch(/[<>]/);
    expect(courses).toEqual(["BTB 101", "BTB 102"]);
  });

  it("does not re-mine clean entries — scraper-provided courses stay as-is", () => {
    const { text, courses } = sanitizePrereqEntry(
      "AUB 111 and AUB 121, or instructor consent. See ENG 101.",
      ["AUB 111", "AUB 121"],
    );
    expect(text).toContain("ENG 101");
    // ENG 101 is mentioned in prose but the scraper chose not to list it —
    // clean entries are not second-guessed.
    expect(courses).toEqual(["AUB 111", "AUB 121"]);
  });

  it("flags markup via hasMarkup", () => {
    expect(hasMarkup("a <br> b")).toBe(true);
    expect(hasMarkup("R&D 101 — no entities here")).toBe(false);
    expect(hasMarkup("Tom &amp; Jerry")).toBe(true);
  });
});
