import { NextRequest, NextResponse } from "next/server";
import { isValidState } from "@/lib/states/registry";
import { buildChain, loadPrereqs } from "@/lib/prereqs";

// Re-export for any external callers that imported these from the route
// before lib/prereqs existed.
export { buildChain, parsePrereqGroups } from "@/lib/prereqs";
export type { ChainNode } from "@/lib/prereqs";

type RouteContext = { params: Promise<{ state: string }> };

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
