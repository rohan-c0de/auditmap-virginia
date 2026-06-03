import { describe, it, expect } from "vitest";
import { parsePrereqGroups, buildChain, type PrereqsMap } from "@/lib/prereqs";

describe("parsePrereqGroups", () => {
  it("groups simple AND into separate (all-required) groups", () => {
    const groups = parsePrereqGroups("ACCT 1010 and ACCT 1015", ["ACCT 1010", "ACCT 1015"]);
    expect(groups).toEqual([["ACCT 1010"], ["ACCT 1015"]]);
  });

  it("groups OR alternatives into one (pick-one) group", () => {
    const groups = parsePrereqGroups("MATH 1130 or MATH 1710", ["MATH 1130", "MATH 1710"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(["MATH 1130", "MATH 1710"]);
  });

  it("detects OR even when course codes are stored mixed-case (the case bug)", () => {
    // Real TN shape: long-form, mixed-case codes in an OR list. A case-sensitive
    // match dropped these out of their group, turning "X or Y" into "X and Y".
    const text = "Business (BUS) 121 (min D) or Accounting  (ACC) 1104 (min D) or ACCT 1010 (min D)";
    const courses = ["Business (BUS) 121", "Accounting  (ACC) 1104", "ACCT 1010"];
    const groups = parsePrereqGroups(text, courses);
    expect(groups).toHaveLength(1); // one OR group, not three required ones
    expect(groups[0]).toHaveLength(3);
  });
});

describe("buildChain groups (end-to-end OR detection)", () => {
  it("marks a mixed-case OR list as a single OR group on the node", () => {
    const map: PrereqsMap = new Map([
      [
        "ACCT 1020",
        {
          text: "Business (BUS) 121 or Accounting  (ACC) 1104 or ACCT 1010",
          courses: ["Business (BUS) 121", "Accounting  (ACC) 1104", "ACCT 1010"],
        },
      ],
    ]);
    const node = buildChain("ACCT 1020", map, new Set(), 0);
    expect(node.groups).toBeDefined();
    expect(node.groups!.some((g) => g.length > 1)).toBe(true);
  });
});
