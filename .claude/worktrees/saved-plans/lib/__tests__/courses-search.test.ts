import { describe, expect, it } from "vitest";
import {
  parseQuery,
  matchesTimeOfDay,
  sectionMatchesDays,
} from "../courses-search";

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
