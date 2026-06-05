import { describe, it, expect } from "vitest";
import { parseCourseFromLabel } from "@/scripts/lib/scrape-acalog-programs";

/**
 * parseCourseFromLabel turns an Acalog course aria-label / link text into
 * {prefix, number, title}. Catalogs vary in how they separate the prefix from
 * the number; the regex must accept all known real formats while still
 * rejecting free-text requirement-group headers ("Choose 3 credits…").
 *
 * The nbsp-hyphen (surry/NC) and hyphen-no-space (mott/MI) rows are the ones
 * the 2026-06-04 fix added; the rest are regression guards for formats that
 * already worked and must keep working.
 */
describe("parseCourseFromLabel — separator formats parse correctly", () => {
  const cases: Array<{
    name: string;
    input: string;
    expected: { prefix: string; number: string; title: string };
  }> = [
    {
      name: "plain space (most common)",
      input: "MAT 171 Precalculus Algebra",
      expected: { prefix: "MAT", number: "171", title: "Precalculus Algebra" },
    },
    {
      name: "dash between number and title (CT)",
      input: "ENG 101 - English Composition",
      expected: { prefix: "ENG", number: "101", title: "English Composition" },
    },
    {
      name: "colon between number and title (Germanna)",
      input: "ENG 111: College Composition I",
      expected: { prefix: "ENG", number: "111", title: "College Composition I" },
    },
    {
      name: "no space between prefix and number (FL Acalog)",
      input: "ACG2021 Financial Accounting",
      expected: { prefix: "ACG", number: "2021", title: "Financial Accounting" },
    },
    {
      name: "no separator + trailing credit parenthetical (gaston)",
      input: "ACA 122 Transfer & Career Success (1 Credit Hour)",
      expected: { prefix: "ACA", number: "122", title: "Transfer & Career Success" },
    },
    {
      name: "hyphen between prefix and number, spaces/nbsp (surry/NC) — FIX",
      input: "WBL - 110 World of Work",
      expected: { prefix: "WBL", number: "110", title: "World of Work" },
    },
    {
      name: "hyphen with no space (mott/MI) — FIX",
      input: "ACCT-101 Applied Accounting",
      expected: { prefix: "ACCT", number: "101", title: "Applied Accounting" },
    },
    {
      name: "number with trailing letter (lab section)",
      input: "BIO 110L Lab",
      expected: { prefix: "BIO", number: "110L", title: "Lab" },
    },
    {
      name: "code only, no title",
      input: "BIO 110",
      expected: { prefix: "BIO", number: "110", title: "" },
    },
  ];

  for (const { name, input, expected } of cases) {
    it(`parses: ${name}`, () => {
      expect(parseCourseFromLabel(input)).toEqual(expected);
    });
  }
});

describe("parseCourseFromLabel — free-text must stay null", () => {
  const negatives = [
    "Math / Natural Science Electives",
    "Choose 3 credits from the following",
    "Select one of the following",
    "General Education Requirements",
    "Restricted Elective",
    "Choose one:",
  ];

  for (const input of negatives) {
    it(`rejects: "${input}"`, () => {
      expect(parseCourseFromLabel(input)).toBeNull();
    });
  }
});
