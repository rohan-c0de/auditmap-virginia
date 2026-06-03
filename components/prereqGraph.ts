// Pure derivation: turn a recursive prerequisite ChainNode tree (from
// lib/prereqs.buildChain) into a laid-out directed graph the PrereqFlowChart
// can render — deduped nodes, longest-path columns, typed + transitively
// reduced edges. No DOM, no React — unit-tested in isolation.

import type { ChainNode } from "@/lib/prereqs";

export type EdgeType = "required" | "or";

export interface GraphNode {
  code: string;
  /** 0 = take first (leftmost column); columnCount-1 = the target course. */
  column: number;
  /** The course the student is looking at (root of the chain). */
  isRoot: boolean;
  /** A starting course — nothing in this chain comes before it. */
  isLeaf: boolean;
}

export interface GraphEdge {
  from: string; // prerequisite course
  to: string; // dependent course (requires `from`)
  type: EdgeType; // "required" (solid) or "or" (one of several, dashed)
}

export interface PrereqGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columnCount: number;
}

// Tokens the loose course-code regex (`[A-Z]{2,5}\s+\d{3,4}`) wrongly accepts
// from messy catalogs — terms/seasons/months mis-extracted as "courses"
// (e.g. NY's "FALL 2023", "FEB 2024"). They must never become graph nodes.
const NON_COURSE_PREFIXES = new Set([
  "FALL", "SPRING", "SUMMER", "WINTER", "FA", "SP", "SU", "WI",
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC",
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST",
  "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]);

/**
 * Whether a token looks like a real course code (subject prefix + number)
 * and not a term/season/date the scraper mis-extracted.
 */
export function isLikelyCourseCode(code: string): boolean {
  const trimmed = (code || "").trim();
  if (!trimmed) return false;
  const prefix = trimmed.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (NON_COURSE_PREFIXES.has(prefix)) return false;
  // Must contain both letters (subject) and digits (number).
  return /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed);
}

/**
 * Clean a course code for display. Some catalogs store the long form
 * ("Business (BUS) 121", "Accounting  (ACC) 1104") — collapse to the real
 * code ("BUS 121", "ACC 1104"). Display only; node identity stays the raw
 * string so edges/keys remain consistent.
 */
export function formatCourseCode(code: string): string {
  const m = code.match(/\(([A-Za-z]{2,6})\)\s*(\d{1,4}[A-Za-z]?)/);
  if (m) return `${m[1].toUpperCase()} ${m[2]}`;
  return code.trim().replace(/\s+/g, " ");
}

/** Edge type for a parent's dependency on `childCourse`, read from the
 *  AND-of-OR `groups`: a child inside an OR group of >1 is "one of several". */
function edgeTypeFor(parent: ChainNode, childCourse: string): EdgeType {
  if (parent.groups) {
    for (const group of parent.groups) {
      if (group.length > 1 && group.some((g) => g.course === childCourse)) {
        return "or";
      }
    }
  }
  return "required";
}

/**
 * Build the laid-out prerequisite graph from a chain tree.
 *
 * - Nodes are deduped course codes (term/date tokens filtered out).
 * - Edges run prerequisite → dependent, typed required/or from the AND-of-OR
 *   groups (so OR-alternatives are never drawn as hard requirements).
 * - Columns use longest-path layering, so every prerequisite always sits in a
 *   column strictly left of everything that depends on it (no backward arrows,
 *   even when two chains share a deeper course — the "diamond" case).
 * - Edges are transitively reduced (drop A→C when A→B→C already exists), so
 *   the picture isn't a thicket of redundant lines.
 */
export function buildPrereqGraph(tree: ChainNode): PrereqGraph {
  const rootCode = tree.course;
  const nodeSet = new Set<string>();
  const edgeMap = new Map<string, EdgeType>(); // "from|to" -> type
  const prereqsOf = new Map<string, Set<string>>(); // dependent -> its prereqs
  const processed = new Set<string>(); // courses whose children are already walked

  function add(parent: ChainNode) {
    if (!isLikelyCourseCode(parent.course)) return;
    nodeSet.add(parent.course);
    if (processed.has(parent.course)) return;
    processed.add(parent.course);

    for (const child of parent.children) {
      if (!isLikelyCourseCode(child.course)) continue;
      nodeSet.add(child.course);
      const key = `${child.course}|${parent.course}`;
      if (!edgeMap.has(key)) edgeMap.set(key, edgeTypeFor(parent, child.course));
      let deps = prereqsOf.get(parent.course);
      if (!deps) prereqsOf.set(parent.course, (deps = new Set()));
      deps.add(child.course);
      add(child);
    }
  }
  add(tree);

  const allEdges: GraphEdge[] = [];
  for (const [key, type] of edgeMap) {
    const [from, to] = key.split("|");
    allEdges.push({ from, to, type });
  }

  // --- longest-path columns: column(node) = 1 + max(column(prereqs)) ---
  const colMemo = new Map<string, number>();
  function column(code: string, stack: Set<string>): number {
    const cached = colMemo.get(code);
    if (cached !== undefined) return cached;
    if (stack.has(code)) return 0; // cycle guard (data is depth-capped, but be safe)
    const prereqs = prereqsOf.get(code);
    if (!prereqs || prereqs.size === 0) {
      colMemo.set(code, 0);
      return 0;
    }
    stack.add(code);
    let max = 0;
    for (const p of prereqs) max = Math.max(max, column(p, stack) + 1);
    stack.delete(code);
    colMemo.set(code, max);
    return max;
  }

  // --- transitive reduction (dependent direction) ---
  const out = new Map<string, Set<string>>();
  for (const e of allEdges) {
    let s = out.get(e.from);
    if (!s) out.set(e.from, (s = new Set()));
    s.add(e.to);
  }
  const descMemo = new Map<string, Set<string>>();
  function descendants(code: string, stack: Set<string>): Set<string> {
    const cached = descMemo.get(code);
    if (cached) return cached;
    if (stack.has(code)) return new Set();
    stack.add(code);
    const set = new Set<string>();
    for (const w of out.get(code) ?? []) {
      set.add(w);
      for (const d of descendants(w, stack)) set.add(d);
    }
    stack.delete(code);
    descMemo.set(code, set);
    return set;
  }
  const reduced = allEdges.filter((e) => {
    for (const w of out.get(e.from) ?? []) {
      if (w !== e.to && descendants(w, new Set()).has(e.to)) return false;
    }
    return true;
  });

  const nodes: GraphNode[] = Array.from(nodeSet)
    .map((code) => ({
      code,
      column: column(code, new Set()),
      isRoot: code === rootCode,
      isLeaf: !(prereqsOf.get(code)?.size),
    }))
    .sort((a, b) => a.column - b.column || a.code.localeCompare(b.code));

  const columnCount = nodes.reduce((m, n) => Math.max(m, n.column + 1), 0);

  return { nodes, edges: reduced, columnCount };
}

/**
 * All courses in `code`'s own chain — itself + every prerequisite leading to
 * it + everything that ultimately depends on it. Used for hover-to-trace.
 */
export function chainOf(code: string, edges: GraphEdge[]): Set<string> {
  const up = new Map<string, string[]>(); // dependent -> prereqs
  const down = new Map<string, string[]>(); // prereq -> dependents
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const e of edges) {
    push(up, e.to, e.from);
    push(down, e.from, e.to);
  }
  const lit = new Set<string>([code]);
  const walk = (start: string, map: Map<string, string[]>) => {
    const stack = [start];
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of map.get(c) ?? []) {
        if (!lit.has(n)) {
          lit.add(n);
          stack.push(n);
        }
      }
    }
  };
  walk(code, up);
  walk(code, down);
  return lit;
}
