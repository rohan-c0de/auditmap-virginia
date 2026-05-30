import { NextRequest, NextResponse } from "next/server";
import {
  loadCoursesForCollege,
  trimCoursesForClient,
} from "@/lib/courses";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";

export const runtime = "edge";

type RouteContext = {
  params: Promise<{ state: string; id: string }>;
};

/**
 * Returns trimmed course sections for a given (state, college, term).
 * Used by CollegeTermSection to lazy-fetch terms other than the default
 * that the server prerendered, reducing the initial RSC payload from
 * ~1 MB (all terms) to ~250 KB (one term).
 *
 * GET /api/{state}/college/{id}/courses?term=X
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { state, id } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const term = request.nextUrl.searchParams.get("term")?.trim();
  if (!term) {
    return NextResponse.json({ error: "Missing term" }, { status: 400 });
  }

  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) {
    return NextResponse.json({ error: "Unknown college" }, { status: 404 });
  }

  const full = await loadCoursesForCollege(institution.college_slug, term, state);

  return NextResponse.json(
    { courses: trimCoursesForClient(full) },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
