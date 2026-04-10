import { NextRequest, NextResponse } from "next/server";
import { isValidState } from "@/lib/states/registry";
import fs from "fs";
import path from "path";

type RouteContext = { params: Promise<{ state: string }> };

/**
 * Prerequisite chain tree node. Each node represents a course and its
 * direct prerequisites, recursively nested. Children are grouped into
 * AND-of-OR groups: outer array = AND (all required), inner array = OR
 * (pick one). A flat `children` array is also provided for backward compat.
 */
interface ChainNode {
  course: string;
  text: string;        // Human-readable prereq description for THIS course
  children: ChainNode[];
  groups?: ChainNode[][]; // AND-of-OR groups (if applicable)
}

/**
 * Load the prereqs.json for a state and return it as a Map.
 */
function loadPrereqs(
  state: string,
): Map<string, { text: string; courses: string[] }> {
  const jsonPath = path.join(process.cwd(), "data", state, "prereqs.json");
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<
      string,
      { text: string; courses: string[] }
    >;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/**
 * Parse prereq text into AND-of-OR groups.
 * "ACC 101 and (BUS 107 or CIS 107)" → [["ACC 101"], ["BUS 107","CIS 107"]]
 */
function parsePrereqGroups(text: string, courses: string[]): string[][] {
  if (courses.length === 0) return [];
  if (courses.length === 1) return [courses];

  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = text.split(/(\s+)/);
  for (const token of tokens) {
    for (const ch of token) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
    if (token.toLowerCase() === "and" && depth === 0 && current.trim()) {
      chunks.push(current.trim());
      current = "";
    } else {
      current += token;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const groups: string[][] = [];
  const assigned = new Set<string>();
  for (const chunk of chunks) {
    const group: string[] = [];
    for (const course of courses) {
      if (assigned.has(course)) continue;
      if (chunk.toUpperCase().includes(course)) {
        group.push(course);
        assigned.add(course);
      }
    }
    if (group.length > 0) groups.push(group);
  }
  for (const course of courses) {
    if (!assigned.has(course)) groups.push([course]);
  }
  return groups;
}

/**
 * Recursively build the prerequisite chain tree. Caps depth at 6 to avoid
 * runaway recursion from circular prereq definitions (which exist in some
 * catalogs, e.g. "MATH A requires MATH B" + "MATH B requires MATH A").
 *
 * Returns both a flat `children` array (backward compat) and a `groups`
 * array that preserves AND-of-OR structure from the prereq text.
 */
function buildChain(
  course: string,
  prereqs: Map<string, { text: string; courses: string[] }>,
  visited: Set<string>,
  depth: number,
): ChainNode {
  const entry = prereqs.get(course);
  const node: ChainNode = {
    course,
    text: entry?.text || "",
    children: [],
  };

  if (depth >= 6 || !entry || visited.has(course)) return node;
  visited.add(course);

  // Build children with AND/OR grouping
  const orGroups = parsePrereqGroups(entry.text, entry.courses);
  const groupNodes: ChainNode[][] = [];

  for (const group of orGroups) {
    const groupChildren: ChainNode[] = [];
    for (const dep of group) {
      const child = buildChain(dep, prereqs, new Set(visited), depth + 1);
      node.children.push(child);
      groupChildren.push(child);
    }
    groupNodes.push(groupChildren);
  }

  // Only include groups if there are actual OR alternatives
  if (groupNodes.some((g) => g.length > 1)) {
    node.groups = groupNodes;
  }

  return node;
}

/**
 * GET /api/[state]/prereqs/chain?course=CHEM+1110
 *
 * Returns the full prerequisite chain tree for a course:
 * {
 *   course: "CHEM 1110",
 *   text: "ACT math score of at least 22 or MATH 1130 or MATH 1710 or MATH 1730",
 *   children: [
 *     { course: "MATH 1130", text: "...", children: [...] },
 *     { course: "MATH 1710", text: "...", children: [...] },
 *     { course: "MATH 1730", text: "...", children: [] }
 *   ]
 * }
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const course = request.nextUrl.searchParams.get("course")?.trim();
  if (!course) {
    return NextResponse.json(
      { error: "Missing ?course= parameter" },
      { status: 400 },
    );
  }

  const prereqs = loadPrereqs(state);
  if (prereqs.size === 0) {
    return NextResponse.json(
      { error: "No prerequisite data available for this state" },
      { status: 404 },
    );
  }

  const tree = buildChain(course, prereqs, new Set(), 0);

  return NextResponse.json(tree, {
    headers: {
      // Cache for 1 hour — prereq data is static between scrapes
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
