import { NextRequest, NextResponse } from "next/server";
import {
  loadCoursesForCollege,
  trimCoursesForClient,
} from "@/lib/courses";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";
import { supabase } from "@/lib/supabase";
import type { CourseSection } from "@/lib/types";

// Run on Vercel's edge runtime — cuts cold function-start from ~2s (Node
// serverless) to ~500ms. All our transitive deps are edge-safe:
//  - `lib/institutions` now uses static JSON imports (no `fs`)
//  - `lib/states/registry` uses static imports (no `require()`)
//  - `@supabase/supabase-js` is edge-compatible
//  - The transfer lookup is built inline via a targeted Supabase query so we
//    don't drag in `lib/transfer`'s multi-MB `fs` fallback.
export const runtime = "edge";

type RouteContext = {
  params: Promise<{ state: string; id: string; prefix: string }>;
};

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

/**
 * Build a transfer lookup scoped to just the courses in `courses`. Uses a
 * single Supabase query with an `OR` of `(cc_prefix, cc_number)` pairs —
 * way smaller than loading the full state catalog and filtering in JS.
 */
async function transferLookupForCourses(
  courses: CourseSection[],
  state: string
): Promise<TransferLookup> {
  if (courses.length === 0) return {};

  // Dedup (prefix, number) pairs
  const pairs = new Map<string, { prefix: string; number: string }>();
  for (const c of courses) {
    pairs.set(`${c.course_prefix}-${c.course_number}`, {
      prefix: c.course_prefix,
      number: c.course_number,
    });
  }

  // Build an OR expression: (cc_prefix.eq.ENG,cc_number.eq.111),(cc_prefix.eq.MTH,cc_number.eq.263),...
  const orClauses = Array.from(pairs.values())
    .map(
      (p) =>
        `and(cc_prefix.eq.${encodeURIComponent(p.prefix)},cc_number.eq.${encodeURIComponent(p.number)})`
    )
    .join(",");

  const { data, error } = await supabase
    .from("transfers")
    .select(
      "cc_prefix, cc_number, university, univ_course, is_elective, no_credit"
    )
    .eq("state", state)
    .or(orClauses);

  if (error) {
    console.error("transferLookupForCourses error:", error.message);
    return {};
  }

  const lookup: TransferLookup = {};
  for (const m of data ?? []) {
    // Skip combo-credit entries (e.g. ODU's "**** ****") — only transfer when
    // paired with other courses, not standalone.
    if (m.univ_course && m.univ_course.includes("*")) continue;
    const key = `${m.cc_prefix}-${m.cc_number}`;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push({
      university: m.university,
      type: m.no_credit ? "no-credit" : m.is_elective ? "elective" : "direct",
      course: m.univ_course || "",
    });
  }
  return lookup;
}

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

  const transferLookup = await transferLookupForCourses(courses, state);

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
