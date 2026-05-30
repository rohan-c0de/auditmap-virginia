import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

import {
  termToCode,
  termMatchesTarget,
  parseMode,
  parseTimes,
  parseDays,
  parsePrerequisites,
  scrapeSections,
} from "../scrape-vccs";

// ---------------------------------------------------------------------------
// Helpers — pure, no I/O
// ---------------------------------------------------------------------------

describe("termToCode", () => {
  it.each([
    ["Spring 2026", "2026SP"],
    ["Summer 2026", "2026SU"],
    ["Fall 2026", "2026FA"],
    ["spring 2026", "2026SP"], // case-insensitive
  ])("converts %j -> %s", (input, expected) => {
    expect(termToCode(input)).toBe(expected);
  });

  it("falls back to compacted whitespace for unrecognised formats", () => {
    expect(termToCode("Winter 2026")).toBe("Winter2026");
  });
});

describe("termMatchesTarget", () => {
  it("matches identical terms after stripping decorations", () => {
    // Real VCCS pages append a glyph like "Spring 2026 ➔" to the heading.
    expect(termMatchesTarget("Spring 2026 ➔", "Spring 2026")).toBe(true);
  });

  it("rejects different seasons of the same year", () => {
    expect(termMatchesTarget("Fall 2026", "Spring 2026")).toBe(false);
  });

  it("rejects same season different year", () => {
    expect(termMatchesTarget("Spring 2025", "Spring 2026")).toBe(false);
  });
});

describe("parseMode", () => {
  it("classifies online (WW) regardless of title", () => {
    expect(parseMode("WW", "")).toBe("online");
    expect(parseMode("X", "Worldwide Online")).toBe("online");
  });

  it("classifies hybrid (HY)", () => {
    expect(parseMode("HY", "")).toBe("hybrid");
    expect(parseMode("X", "Hybrid Course")).toBe("hybrid");
  });

  it("classifies zoom-style synchronous-remote", () => {
    expect(parseMode("CV", "")).toBe("zoom");
    expect(parseMode("X", "Interactive Video")).toBe("zoom");
    expect(parseMode("X", "Zoom Meeting")).toBe("zoom");
  });

  it("defaults to in-person", () => {
    expect(parseMode("P", "In-Person Course")).toBe("in-person");
    expect(parseMode("", "")).toBe("in-person");
  });
});

describe("parseTimes", () => {
  it("returns TBA for empty / TBA / null-equivalent input", () => {
    expect(parseTimes("")).toEqual(["TBA", "TBA"]);
    expect(parseTimes("TBA")).toEqual(["TBA", "TBA"]);
    expect(parseTimes("tba")).toEqual(["TBA", "TBA"]);
  });

  it("normalises 'a.m.' / 'p.m.' to AM/PM", () => {
    expect(parseTimes("9:00 a.m. - 9:50 a.m.")).toEqual([
      "9:00 AM",
      "9:50 AM",
    ]);
    expect(parseTimes("1:00 p.m. - 2:15 p.m.")).toEqual([
      "1:00 PM",
      "2:15 PM",
    ]);
  });

  it("handles different dash characters", () => {
    expect(parseTimes("9:00 AM – 9:50 AM")).toEqual(["9:00 AM", "9:50 AM"]);
    expect(parseTimes("9:00 AM — 9:50 AM")).toEqual(["9:00 AM", "9:50 AM"]);
  });

  it("collapses non-breaking spaces", () => {
    expect(parseTimes("9:00 AM - 9:50 AM")).toEqual([
      "9:00 AM",
      "9:50 AM",
    ]);
  });

  it("returns TBA when only one side parses", () => {
    expect(parseTimes("0:00 AM - 9:50 AM")).toEqual(["TBA", "TBA"]);
    expect(parseTimes("12:00 AM - 12:00 AM")).toEqual(["TBA", "TBA"]);
  });

  it("returns TBA when there is no dash", () => {
    expect(parseTimes("9:00 AM")).toEqual(["TBA", "TBA"]);
  });
});

describe("parseDays", () => {
  it("joins active day spans with a single space", () => {
    const $ = cheerio.load(
      `<div class="days">
        <span class="s">M</span>
        <span class="s">W</span>
        <span class="s">F</span>
      </div>`
    );
    expect(parseDays($, $("div.days"))).toBe("M W F");
  });

  it("returns empty string when there are no active spans", () => {
    const $ = cheerio.load('<div class="days"></div>');
    expect(parseDays($, $("div.days"))).toBe("");
  });
});

describe("parsePrerequisites", () => {
  it("extracts text and linked course codes", () => {
    const $ = cheerio.load(`
      <div class="endtext">
        Foundation course.
        Prerequisite: <a href="/courses/MTH161">MTH 161</a> or
        <a href="/courses/MTH162">MTH 162</a>.
      </div>
    `);
    const result = parsePrerequisites($);
    expect(result.text).toContain("MTH 161");
    expect(result.courses).toEqual(expect.arrayContaining(["MTH 161", "MTH 162"]));
  });

  it("also catches unlinked course codes mentioned in the text", () => {
    const $ = cheerio.load(`
      <div class="endtext">
        Prerequisite: ENG 111 or equivalent placement.
      </div>
    `);
    const result = parsePrerequisites($);
    expect(result.courses).toContain("ENG 111");
  });

  it("returns null/[] when no prerequisite block is present", () => {
    const $ = cheerio.load(`
      <div class="endtext">A standalone course with no prereqs.</div>
    `);
    expect(parsePrerequisites($)).toEqual({ text: null, courses: [] });
  });
});

// ---------------------------------------------------------------------------
// scrapeSections — fixture-driven; the highest-value test, since this
// guards against a parser regression silently writing junk to data/.
// ---------------------------------------------------------------------------

function fixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, "..", "__fixtures__", name),
    "utf-8"
  );
}

describe("scrapeSections", () => {
  it("parses two sections from the happy-path fixture for the target term", () => {
    const html = fixture("course-page-happy.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    expect(sections).toHaveLength(2);
  });

  it("extracts identity + schedule fields for an in-person section", () => {
    const html = fixture("course-page-happy.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    const inPerson = sections.find((s) => s.crn === "70056")!;
    expect(inPerson).toMatchObject({
      college_code: "nova",
      term: "2026SP",
      course_prefix: "ENG",
      course_number: "111",
      course_title: "College Composition I",
      credits: 3,
      crn: "70056",
      days: "M W F",
      start_time: "9:00 AM",
      end_time: "9:50 AM",
      campus: "Annandale",
      mode: "in-person",
    });
  });

  it("classifies a WW section as online with TBA times and no days", () => {
    const html = fixture("course-page-happy.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    const online = sections.find((s) => s.crn === "70057")!;
    expect(online.mode).toBe("online");
    expect(online.start_time).toBe("TBA");
    expect(online.end_time).toBe("TBA");
    expect(online.days).toBe("");
  });

  it("attaches per-course prerequisites to every section", () => {
    const html = fixture("course-page-happy.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    expect(sections.every((s) => s.prerequisite_courses.includes("ENF 003"))).toBe(true);
    expect(sections[0].prerequisite_text).toContain("ENF 003");
  });

  it("ignores sections from non-matching term cards", () => {
    const html = fixture("course-page-happy.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    // The fixture has a Fall 2025 card with CRN 99999. It should NOT appear
    // when the caller asks for Spring 2026 — this is the silent-staleness
    // guard.
    expect(sections.find((s) => s.crn === "99999")).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Drift cases — degenerate inputs that the scraper sometimes encounters
  // (auth-wall redirect, stale term page). Parser must return [] rather
  // than emit junk rows that would slip past schema validation.
  // ---------------------------------------------------------------------------

  it("returns [] when no schedule card matches the requested term", () => {
    const html = fixture("course-page-no-target-term.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    expect(sections).toEqual([]);
  });

  it("returns [] when the page has no schedule div at all (auth wall / 404 surrogate)", () => {
    const html = fixture("course-page-empty.html");
    const sections = scrapeSections(
      html,
      "nova",
      "ENG",
      "111",
      "College Composition I",
      "Spring 2026"
    );
    expect(sections).toEqual([]);
  });

  it("returns [] when handed empty / whitespace HTML", () => {
    expect(scrapeSections("", "nova", "ENG", "111", "x", "Spring 2026")).toEqual([]);
    expect(scrapeSections("   \n  ", "nova", "ENG", "111", "x", "Spring 2026")).toEqual([]);
  });
});
