import { describe, expect, it } from "vitest";
import {
  parseQuery,
  matchesTimeOfDay,
  sectionMatchesDays,
  meaningfulKeywordTokens,
} from "../courses-search";

describe("meaningfulKeywordTokens (zero-result rescue)", () => {
  it("strips course/qualifier filler, keeping the subject", () => {
    expect(meaningfulKeywordTokens("math courses without prerequisite?")).toEqual(["math"]);
    expect(meaningfulKeywordTokens("biology classes")).toEqual(["biology"]);
  });
  it("keeps multiple subject tokens", () => {
    expect(meaningfulKeywordTokens("online accounting courses")).toEqual(["online", "accounting"]);
  });
  it("drops level/scope descriptors so the rescue stays on-subject (not cross-subject)", () => {
    // The bug: "intermediate" re-queried as a title substring and pulled in
    // Intermediate Algebra / Accounting / etc. into an Arabic search's grid.
    expect(meaningfulKeywordTokens("Intermediate Arabic II")).toEqual(["arabic"]);
    expect(meaningfulKeywordTokens("intro to psychology")).toEqual(["psychology"]);
    expect(meaningfulKeywordTokens("principles of accounting")).toEqual(["accounting"]);
    expect(meaningfulKeywordTokens("beginning spanish")).toEqual(["spanish"]);
    expect(meaningfulKeywordTokens("general biology")).toEqual(["biology"]);
    // a query that is ONLY descriptors → no tokens → rescue skipped (stays 0)
    expect(meaningfulKeywordTokens("introduction")).toEqual([]);
    expect(meaningfulKeywordTokens("advanced intermediate")).toEqual([]);
  });
  it("strips question/stop words from raw NL sentences (the /ask grid case)", () => {
    // The screenshot query: the whole sentence reaches the grid. Without
    // stop-word stripping, "are"/"there" substring-match across all subjects.
    expect(
      meaningfulKeywordTokens("are there any prerequisite for Intermediate Arabic II"),
    ).toEqual(["arabic"]);
    expect(meaningfulKeywordTokens("what biology classes are available")).toEqual(["biology"]);
    expect(meaningfulKeywordTokens("show me online nursing courses")).toEqual(["online", "nursing"]);
  });
  it("drops tokens under 3 chars and punctuation", () => {
    // "of" = filler, "ml" = under 3 chars → both dropped; "art" kept.
    expect(meaningfulKeywordTokens("art of ml")).toEqual(["art"]);
  });
  it("returns [] when only filler remains, so the rescue is skipped (stays 0)", () => {
    expect(meaningfulKeywordTokens("courses that have no prerequisites")).toEqual([]);
    expect(meaningfulKeywordTokens("any courses with no prereqs")).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("parses an exact course code with space", () => {
    expect(parseQuery("ENG 111")).toEqual({
      prefix: "ENG",
      number: "111",
      keyword: null,
    });
  });

  it("parses an exact course code without space", () => {
    expect(parseQuery("ENG111")).toEqual({
      prefix: "ENG",
      number: "111",
      keyword: null,
    });
  });

  it("uppercases lowercase course codes", () => {
    expect(parseQuery("eng 111")).toEqual({
      prefix: "ENG",
      number: "111",
      keyword: null,
    });
  });

  it("parses a prefix-only query", () => {
    expect(parseQuery("ENG")).toEqual({
      prefix: "ENG",
      number: null,
      keyword: null,
    });
  });

  it("treats free-text as a lowercased keyword on title", () => {
    expect(parseQuery("Introduction to Biology")).toEqual({
      prefix: null,
      number: null,
      keyword: "introduction to biology",
    });
  });

  it("trims whitespace before classifying", () => {
    expect(parseQuery("  ENG 111  ")).toEqual({
      prefix: "ENG",
      number: "111",
      keyword: null,
    });
  });
});

describe("matchesTimeOfDay", () => {
  it.each([
    ["9:00 AM", "morning", true],
    ["11:59 AM", "morning", true],
    ["12:30 AM", "morning", true],
    ["12:00 PM", "afternoon", true],
    ["1:00 PM", "afternoon", true],
    ["4:59 PM", "afternoon", true],
    ["5:00 PM", "evening", true],
    ["7:30 PM", "evening", true],
    ["12:00 PM", "morning", false],
    ["5:00 PM", "afternoon", false],
    ["11:00 AM", "afternoon", false],
  ] as const)("matchesTimeOfDay(%j, %j) === %s", (time, bucket, expected) => {
    expect(matchesTimeOfDay(time, bucket)).toBe(expected);
  });

  it("returns false for TBA, empty, or malformed times", () => {
    expect(matchesTimeOfDay("TBA", "morning")).toBe(false);
    expect(matchesTimeOfDay("", "morning")).toBe(false);
    expect(matchesTimeOfDay("garbage", "morning")).toBe(false);
    expect(matchesTimeOfDay("9:00", "morning")).toBe(false);
  });

  it("accepts lowercase AM/PM", () => {
    expect(matchesTimeOfDay("9:00 am", "morning")).toBe(true);
    expect(matchesTimeOfDay("1:00 pm", "afternoon")).toBe(true);
  });
});

describe("sectionMatchesDays", () => {
  it("returns true when ANY filter day appears in the section days", () => {
    expect(sectionMatchesDays("M W F", ["M"])).toBe(true);
    expect(sectionMatchesDays("M W F", ["Tu", "Th"])).toBe(false);
    expect(sectionMatchesDays("Tu Th", ["M", "Tu"])).toBe(true);
  });

  it("returns false on empty input", () => {
    expect(sectionMatchesDays("", ["M"])).toBe(false);
  });

  it("uses exact token match — does not match Th against T", () => {
    // The function splits on space, so "Th" is a separate token from "T".
    expect(sectionMatchesDays("Th", ["T"])).toBe(false);
    expect(sectionMatchesDays("Th", ["Th"])).toBe(true);
  });
});
