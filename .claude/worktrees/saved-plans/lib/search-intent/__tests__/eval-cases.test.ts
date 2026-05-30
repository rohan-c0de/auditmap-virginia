import { describe, expect, it } from "vitest";
import { EVAL_CASES, type EvalCase } from "../eval/cases";

describe("EVAL_CASES fixture", () => {
  it("has at least 60 cases", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(60);
  });

  it("has substantial non-VA coverage (project is national)", () => {
    const nonVa = EVAL_CASES.filter((c) => c.tags?.includes("non-va")).length;
    // Floor of 10 keeps us honest about not regressing into VCCS-only fixtures.
    expect(nonVa, `only ${nonVa} non-VA cases`).toBeGreaterThanOrEqual(10);
  });

  it("has at least one alias-resolution case", () => {
    const hasAlias = EVAL_CASES.some((c) => c.tags?.includes("alias"));
    expect(hasAlias).toBe(true);
  });

  it("has unique ids", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("has non-empty queries", () => {
    for (const c of EVAL_CASES) {
      expect(c.query.length, `case ${c.id}: query is empty`).toBeGreaterThan(0);
    }
  });

  it("covers each category with at least 3 cases", () => {
    const REQUIRED_CATEGORIES: EvalCase["category"][] = [
      "course-code",
      "course-keyword",
      "prereqs",
      "transfer",
      "pathway",
      "eligibility",
      "course-with-filters",
      "vague",
      "multi-intent",
      "gibberish",
    ];
    for (const cat of REQUIRED_CATEGORIES) {
      const count = EVAL_CASES.filter((c) => c.category === cat).length;
      expect(count, `category "${cat}" has only ${count} cases`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has at least one typo case (otherwise we're not testing realistic input)", () => {
    const hasTypo = EVAL_CASES.some((c) => c.tags?.includes("typo"));
    expect(hasTypo).toBe(true);
  });

  it("has at least one multi-intent case", () => {
    const hasMulti = EVAL_CASES.some((c) => c.tags?.includes("multi-intent"));
    expect(hasMulti).toBe(true);
  });

  it("only uses valid expected intent types", () => {
    const VALID = new Set([
      "transfer",
      "pathway",
      "prereqs",
      "eligibility",
      "course",
      "unknown",
      "any-of",
    ]);
    for (const c of EVAL_CASES) {
      expect(VALID.has(c.expected.type), `case ${c.id} has bad type ${c.expected.type}`).toBe(true);
    }
  });
});
