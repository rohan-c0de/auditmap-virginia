import { describe, it, expect } from "vitest";
import {
  countMentions,
  hasEnumeratedCombos,
  parseSlotGroups,
  parseComboOptions,
  parsePrereqGroups,
  resolveRequirements,
} from "@/lib/prereq-groups";

// Real entry from data/oh/prereqs.json (Cuyahoga / Tri-C, BIO 2331 Anatomy &
// Physiology I) — the text that shipped the planner's OR-as-AND bug: 8
// alternatives rendered as 8 required courses.
const BIO_2331_TEXT =
  "Biology 1100 (min C) or Biology 1110 (min C) or Chemistry 1010 (min C) and Chemistry 1020 (min C) or Chemistry 101H (min C) and Chemistry 1020 (min C) or Chemistry 101H (min C) and Chemistry 102H (min C) or Chemistry 1010 (min C) and Chemistry 102H (min C) or Biology 1500 (min C) or Biology 150H (min C)";
const BIO_2331_COURSES = [
  "Biology 1100",
  "Biology 1110",
  "Chemistry 1010",
  "Chemistry 1020",
  "Chemistry 101H",
  "Chemistry 102H",
  "Biology 1500",
  "Biology 150H",
];

describe("countMentions", () => {
  it("counts case-insensitively with word boundaries", () => {
    expect(countMentions("MATH 101 and math 101", "Math 101")).toBe(2);
  });

  it("does not match inside a longer course number", () => {
    // "MATH 101" must not match inside "MATH 1010" / "MATH 101H".
    expect(countMentions("MATH 1010 or MATH 101H", "MATH 101")).toBe(0);
  });
});

describe("hasEnumeratedCombos", () => {
  it("detects the Tri-C enumerated-combination style (repeated mentions)", () => {
    expect(hasEnumeratedCombos(BIO_2331_TEXT, BIO_2331_COURSES)).toBe(true);
  });

  it("is false for slot-style texts where each course appears once", () => {
    // NC ACC 115: (ENG 002 or ENG 025) and (MAT 003 or MAT 025 or MAT 035)
    expect(
      hasEnumeratedCombos("ENG 002 or ENG 025 and MAT 003 or MAT 025 or MAT 035", [
        "ENG 002",
        "ENG 025",
        "MAT 003",
        "MAT 025",
        "MAT 035",
      ]),
    ).toBe(false);
  });

  it("is false without any top-level 'or'", () => {
    expect(
      hasEnumeratedCombos("ACC 101 and ACC 101", ["ACC 101", "BUS 107"]),
    ).toBe(false);
  });
});

describe("parseComboOptions", () => {
  it("splits BIO 2331 into 8 alternatives with correct AND-pairs", () => {
    const { options, required } = parseComboOptions(BIO_2331_TEXT, BIO_2331_COURSES);
    expect(required).toEqual([]);
    expect(options).toEqual([
      ["Biology 1100"],
      ["Biology 1110"],
      ["Chemistry 1010", "Chemistry 1020"],
      ["Chemistry 101H", "Chemistry 1020"],
      ["Chemistry 101H", "Chemistry 102H"],
      ["Chemistry 1010", "Chemistry 102H"],
      ["Biology 1500"],
      ["Biology 150H"],
    ]);
  });

  it("keeps unmentioned courses as unconditionally required", () => {
    const { options, required } = parseComboOptions("A 1 or A 2", ["A 1", "A 2", "B 9"]);
    expect(options).toEqual([["A 1"], ["A 2"]]);
    expect(required).toEqual(["B 9"]);
  });
});

describe("parsePrereqGroups (combined view)", () => {
  it("slot style: 'A and B or C' → A required, B/C one OR group", () => {
    // OH BIO 121 shape: BIO 010 and (ENGL 012 or ENGL 100) and CHEM 020
    expect(
      parsePrereqGroups("BIO 010 and ENGL 012 or ENGL 100 and CHEM 020", [
        "BIO 010",
        "ENGL 012",
        "ENGL 100",
        "CHEM 020",
      ]),
    ).toEqual([["BIO 010"], ["ENGL 012", "ENGL 100"], ["CHEM 020"]]);
  });

  it("combo style collapses all combination members into one OR group", () => {
    const groups = parsePrereqGroups(BIO_2331_TEXT, BIO_2331_COURSES);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(8);
  });

  it("mixed-case mentions stay in their OR group (the planner case bug)", () => {
    const groups = parseSlotGroups(
      "Biology 1100 (min C) or Biology 1110 (min C)",
      ["Biology 1100", "Biology 1110"],
    );
    expect(groups).toEqual([["Biology 1100", "Biology 1110"]]);
  });
});

describe("resolveRequirements", () => {
  const unitCost = () => 1;

  it("BIO 2331 resolves to ONE requirement (cheapest single course) with 7 alternatives", () => {
    const reqs = resolveRequirements(BIO_2331_TEXT, BIO_2331_COURSES, unitCost);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].chosen).toEqual(["Biology 1100"]);
    expect(reqs[0].alternatives).toHaveLength(7);
  });

  it("prefers the cheaper combination when costs differ", () => {
    const cost = (c: string) => (c === "Biology 1100" ? 10 : 1);
    const reqs = resolveRequirements(BIO_2331_TEXT, BIO_2331_COURSES, cost);
    // Biology 1110 (cost 1) now beats Biology 1100 (cost 10).
    expect(reqs[0].chosen).toEqual(["Biology 1110"]);
  });

  it("slot style yields one requirement per AND slot, picking one OR option each", () => {
    const reqs = resolveRequirements(
      "BIO 010 and ENGL 012 or ENGL 100 and CHEM 020",
      ["BIO 010", "ENGL 012", "ENGL 100", "CHEM 020"],
      unitCost,
    );
    expect(reqs.map((r) => r.chosen)).toEqual([["BIO 010"], ["ENGL 012"], ["CHEM 020"]]);
    expect(reqs[1].alternatives).toEqual([["ENGL 100"]]);
  });

  it("true ANDs stay required — no alternatives invented", () => {
    const reqs = resolveRequirements(
      "ACC 101 and BUS 107",
      ["ACC 101", "BUS 107"],
      unitCost,
    );
    expect(reqs).toEqual([
      { chosen: ["ACC 101"], alternatives: [] },
      { chosen: ["BUS 107"], alternatives: [] },
    ]);
  });

  it("parenthesized OR group keeps the AND member required", () => {
    const reqs = resolveRequirements(
      "ACC 101 and (BUS 107 or CIS 107)",
      ["ACC 101", "BUS 107", "CIS 107"],
      unitCost,
    );
    expect(reqs[0]).toEqual({ chosen: ["ACC 101"], alternatives: [] });
    expect(reqs[1].chosen).toEqual(["BUS 107"]);
    expect(reqs[1].alternatives).toEqual([["CIS 107"]]);
  });
});
