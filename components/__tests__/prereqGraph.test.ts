import { describe, it, expect } from "vitest";
import { buildPrereqGraph, chainOf, isLikelyCourseCode, formatCourseCode } from "../prereqGraph";
import type { ChainNode } from "@/lib/prereqs";

function n(course: string, children: ChainNode[] = [], groups?: ChainNode[][]): ChainNode {
  return { course, text: "", children, ...(groups ? { groups } : {}) };
}

const codes = (g: ReturnType<typeof buildPrereqGraph>) => g.nodes.map((x) => x.code).sort();
const col = (g: ReturnType<typeof buildPrereqGraph>, code: string) =>
  g.nodes.find((x) => x.code === code)?.column;
const hasEdge = (g: ReturnType<typeof buildPrereqGraph>, from: string, to: string) =>
  g.edges.some((e) => e.from === from && e.to === to);
const edge = (g: ReturnType<typeof buildPrereqGraph>, from: string, to: string) =>
  g.edges.find((e) => e.from === from && e.to === to);

// Realistic course codes (a subject prefix + number — isLikelyCourseCode
// requires a digit, exactly as real catalog data has).
const A = "AA 1";
const B = "BB 2";
const C = "CC 3";
const D = "DD 4";
const X = "XX 9";

describe("isLikelyCourseCode", () => {
  it("accepts real course codes", () => {
    expect(isLikelyCourseCode("ACCT 1020")).toBe(true);
    expect(isLikelyCourseCode("MATH 1130")).toBe(true);
  });
  it("rejects term/season/month tokens the loose regex mis-extracts", () => {
    expect(isLikelyCourseCode("FALL 2023")).toBe(false);
    expect(isLikelyCourseCode("FEB 2024")).toBe(false);
    expect(isLikelyCourseCode("SPRING 2025")).toBe(false);
  });
  it("rejects non-course phrases and empties", () => {
    expect(isLikelyCourseCode("department approval")).toBe(false); // no digit
    expect(isLikelyCourseCode("")).toBe(false);
    expect(isLikelyCourseCode("C")).toBe(false); // no digit
  });
});

describe("buildPrereqGraph", () => {
  it("lays out a linear chain left→right with the target rightmost", () => {
    // target C ← B ← A
    const g = buildPrereqGraph(n(C, [n(B, [n(A)])]));
    expect(codes(g)).toEqual([A, B, C]);
    expect(col(g, A)).toBe(0);
    expect(col(g, B)).toBe(1);
    expect(col(g, C)).toBe(2);
    expect(g.columnCount).toBe(3);
    expect(g.nodes.find((x) => x.code === C)?.isRoot).toBe(true);
    expect(g.nodes.find((x) => x.code === A)?.isLeaf).toBe(true);
    expect(hasEdge(g, A, B)).toBe(true);
    expect(hasEdge(g, B, C)).toBe(true);
  });

  it("marks OR-group dependencies as 'or' (one of several)", () => {
    const a = n(A);
    const b = n(B);
    const g = buildPrereqGraph(n(X, [a, b], [[a, b]]));
    expect(edge(g, A, X)?.type).toBe("or");
    expect(edge(g, B, X)?.type).toBe("or");
  });

  it("marks plain AND dependencies as 'required'", () => {
    const g = buildPrereqGraph(n(X, [n(A), n(B)]));
    expect(edge(g, A, X)?.type).toBe("required");
    expect(edge(g, B, X)?.type).toBe("required");
  });

  it("handles mixed AND-of-OR: 'A and (B or C)'", () => {
    const a = n(A);
    const b = n(B);
    const c = n(C);
    const g = buildPrereqGraph(n(X, [a, b, c], [[a], [b, c]]));
    expect(edge(g, A, X)?.type).toBe("required");
    expect(edge(g, B, X)?.type).toBe("or");
    expect(edge(g, C, X)?.type).toBe("or");
  });

  it("filters out term/date tokens so they never become nodes", () => {
    const g = buildPrereqGraph(n("ACCT 1020", [n("ACCT 1010"), n("FALL 2023")]));
    expect(codes(g)).toEqual(["ACCT 1010", "ACCT 1020"]);
    expect(g.edges).toHaveLength(1);
    expect(hasEdge(g, "ACCT 1010", "ACCT 1020")).toBe(true);
  });

  it("transitively reduces redundant edges (drop A→C when A→B→C exists)", () => {
    // X requires A and C; A requires C  → the direct C→X line is redundant
    const g = buildPrereqGraph(n(X, [n(A, [n(C)]), n(C)]));
    expect(hasEdge(g, C, A)).toBe(true);
    expect(hasEdge(g, A, X)).toBe(true);
    expect(hasEdge(g, C, X)).toBe(false); // dropped by reduction
    expect(col(g, C)).toBe(0);
    expect(col(g, X)).toBe(2);
  });

  it("uses longest-path columns so a shared deep prereq sits leftmost", () => {
    // X ← A ← D and X ← B ← D : D must be column 0, left of both A and B
    const g = buildPrereqGraph(n(X, [n(A, [n(D)]), n(B, [n(D)])]));
    expect(col(g, D)).toBe(0);
    expect(col(g, A)).toBe(1);
    expect(col(g, B)).toBe(1);
    expect(col(g, X)).toBe(2);
  });

  it("returns an empty graph for a leaf target (no prereqs)", () => {
    const g = buildPrereqGraph(n("BIOL 2010"));
    expect(g.nodes.length).toBeLessThanOrEqual(1);
    expect(g.edges).toHaveLength(0);
  });
});

describe("formatCourseCode", () => {
  it("collapses long-form codes to the real code", () => {
    expect(formatCourseCode("Business (BUS) 121")).toBe("BUS 121");
    expect(formatCourseCode("Accounting  (ACC) 1104")).toBe("ACC 1104");
  });
  it("leaves clean codes untouched (modulo whitespace)", () => {
    expect(formatCourseCode("ACCT 1010")).toBe("ACCT 1010");
    expect(formatCourseCode("MATH  1130")).toBe("MATH 1130");
  });
});

describe("chainOf", () => {
  it("includes self, ancestors, and descendants of a course", () => {
    const g = buildPrereqGraph(n(C, [n(B, [n(A)])]));
    expect(chainOf(B, g.edges)).toEqual(new Set([A, B, C]));
  });

  it("does not light sibling branches", () => {
    // X ← A and X ← B (independent). A's chain is {A, X}, not B.
    const g = buildPrereqGraph(n(X, [n(A), n(B)]));
    const lit = chainOf(A, g.edges);
    expect(lit.has(X)).toBe(true);
    expect(lit.has(A)).toBe(true);
    expect(lit.has(B)).toBe(false);
  });

  it("lights the full chain through a diamond, not the sibling branch", () => {
    // X ← A ← D and X ← B ← D. A's chain: D (ancestor) + X (descendant) + A; not B.
    const g = buildPrereqGraph(n(X, [n(A, [n(D)]), n(B, [n(D)])]));
    const lit = chainOf(A, g.edges);
    expect(lit.has(A)).toBe(true);
    expect(lit.has(D)).toBe(true);
    expect(lit.has(X)).toBe(true);
    expect(lit.has(B)).toBe(false);
  });
});

describe("buildPrereqGraph — cycle safety (defensive)", () => {
  it("terminates and yields finite columns on a cyclic input (A↔B)", () => {
    // Real chains are acyclic (buildChain breaks cycles), but the graph layout
    // must never hang or produce Infinity if a cycle ever slips through.
    const a = n(A);
    const b = n(B, [a]);
    a.children.push(b); // A ← B ← A
    const g = buildPrereqGraph(n(X, [a]));
    expect(codes(g)).toEqual([A, B, X].sort());
    g.nodes.forEach((node) => expect(Number.isFinite(node.column)).toBe(true));
  });
});
