import { describe, expect, it } from "vitest";
import { buildSequence } from "../planner";
import type { PlanCourse, PlanGroup } from "../planner";

// Minimal PlanCourse factory — only the fields buildSequence reads matter.
function course(prefix: string, number: string, credits = 3): PlanCourse {
  return {
    prefix,
    number,
    code: `${prefix} ${number}`,
    title: `${prefix} ${number}`,
    credits,
    alternatives: [],
    transfers: {},
    acceptingCount: 0,
    sectionsThisTerm: 0,
  };
}

function group(courses: PlanCourse[], chooseN: number | null = null): PlanGroup {
  return { name: "G", creditsRequired: null, chooseN, courses, unenumerated: false };
}

function prereqMap(entries: Record<string, string[]>): Map<string, { text: string; courses: string[] }> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, { text: "", courses: v }]));
}

const termOf = (seq: NonNullable<ReturnType<typeof buildSequence>>, code: string) =>
  seq.terms.find((t) => t.courses.some((c) => c.code === code))!.index;

describe("buildSequence", () => {
  it("orders a prereq chain across terms (A → B → C)", () => {
    const groups = [group([course("ENG", "101"), course("ENG", "102"), course("ENG", "201")])];
    const seq = buildSequence(groups, prereqMap({ "ENG 102": ["ENG 101"], "ENG 201": ["ENG 102"] }));
    expect(seq).not.toBeNull();
    expect(termOf(seq!, "ENG 102")).toBeGreaterThan(termOf(seq!, "ENG 101"));
    expect(termOf(seq!, "ENG 201")).toBeGreaterThan(termOf(seq!, "ENG 102"));
  });

  it("ignores prereqs outside the program (no false ordering edge)", () => {
    // BUS 101→100 and BUS 102→101 are intra edges (pass the gate). BUS 200's
    // only prereq (MAT 150) is OUTSIDE the program → it must stay in term 1.
    const seq = buildSequence(
      [group([course("BUS", "100"), course("BUS", "101"), course("BUS", "102"), course("BUS", "200")])],
      prereqMap({ "BUS 101": ["BUS 100"], "BUS 102": ["BUS 101"], "BUS 200": ["MAT 150"] }),
    );
    expect(seq).not.toBeNull();
    expect(termOf(seq!, "BUS 200")).toBe(1);
  });

  it("caps credits per term (6 × 3cr courses split across terms at cap 16)", () => {
    const six = Array.from({ length: 6 }, (_, i) => course("ART", `10${i}`));
    // Give them a light chain so coverage/edges pass the gate.
    const seq = buildSequence([group(six)], prereqMap({ "ART 101": ["ART 100"], "ART 102": ["ART 100"] }));
    expect(seq).not.toBeNull();
    // 18 credits total, cap 16 → at least 2 terms.
    expect(seq!.terms.length).toBeGreaterThanOrEqual(2);
    for (const t of seq!.terms) expect(t.credits).toBeLessThanOrEqual(16);
  });

  it("returns null when prereq coverage is too thin to order", () => {
    const groups = [group([course("X", "1"), course("X", "2"), course("X", "3"), course("X", "4")])];
    expect(buildSequence(groups, prereqMap({}))).toBeNull();
  });

  it("sequences only N representatives of a choose-N group", () => {
    const seq = buildSequence(
      [
        group([course("CORE", "1"), course("CORE", "2"), course("CORE", "3")]),
        group([course("OPT", "1"), course("OPT", "2")], 1), // choose 1 of 2
      ],
      prereqMap({ "CORE 2": ["CORE 1"], "CORE 3": ["CORE 2"] }),
    );
    expect(seq).not.toBeNull();
    const codes = seq!.terms.flatMap((t) => t.courses.map((c) => c.code));
    expect(codes).toContain("OPT 1");
    expect(codes).not.toContain("OPT 2"); // only the first of the choose-1 group
  });
});
