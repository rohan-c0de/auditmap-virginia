import { NextRequest, NextResponse } from "next/server";
import {
  loadCoursesForCollege,
  trimCoursesForClient,
} from "@/lib/courses";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";
import { buildTransferLookupForCourses } from "@/lib/transfer-scoped";

// Run on Vercel's edge runtime — cuts cold function-start from ~2s (Node
// serverless) to ~500ms. All our transitive deps are edge-safe:
//  - `lib/institutions` uses static JSON imports (no `fs`)
//  - `lib/states/registry` uses static imports (no `require()`)
//  - `@supabase/supabase-js` is edge-compatible
//  - `buildTransferLookupForCourses` is a Supabase-only scoped query.
//    `lib/transfer` still references `fs` for the global-lookup fallback,
//    but Turbopack tree-shakes it out since the edge bundle only imports
//    the scoped helper.
export const runtime = "edge";

type RouteContext = {
  params: Promise<{ state: string; id: string; prefix: string }>;
};

/**
 * Returns the trimmed course list and a filtered transfer lookup for a given
 * (state, college, subject, term). Used by the subject page to lazy-load
 * terms other than the default that the server prerendered — keeps cold ISR
 * latency bounded to a single-term load.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { state, id, prefix: rawPrefix } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const term = request.nextUrl.searchParams.get("term")?.trim();
  if (!term) {
    return NextResponse.json({ error: "Missing term" }, { status: 400 });
  }

  const prefix = rawPrefix.toUpperCase();
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) {
    return NextResponse.json({ error: "Unknown college" }, { status: 404 });
  }

  const full = await loadCoursesForCollege(
    institution.college_slug,
    term,
    state
  );
  const courses = full.filter((c) => c.course_prefix === prefix);

  const transferLookup = await buildTransferLookupForCourses(courses, state);

  return NextResponse.json(
    {
      courses: trimCoursesForClient(courses),
      transferLookup,
    },
    {
      headers: {
        // Cache at the edge — contents only change when Supabase data updates,
        // which we reflect via the same `revalidate = 86400` cadence as the
        // page itself.
        "Cache-Control":
          "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
