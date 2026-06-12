import { NextRequest, NextResponse } from "next/server";
import { searchCoursesAcrossColleges } from "@/lib/courses-search";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";
import { getCurrentTerm } from "@/lib/terms";
import { getAvailableTerms } from "@/lib/courses";

type RouteContext = { params: Promise<{ state: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const { allowed, remaining } = rateLimit(getClientKey(request));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60", "X-RateLimit-Remaining": "0" } }
    );
  }

  const institutions = loadInstitutions(state);
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() || "";
  const zip = searchParams.get("zip")?.trim() || undefined;
  const mode = searchParams.get("mode")?.trim() || undefined;
  // Support multi-day param (comma-separated) with backward compat for single "day" param
  const daysParam = searchParams.get("days")?.trim();
  const singleDay = searchParams.get("day")?.trim();
  const days = daysParam
    ? daysParam.split(",").map((d) => d.trim()).filter(Boolean)
    : singleDay
      ? [singleDay]
      : undefined;
  const timeOfDayRaw = searchParams.get("timeOfDay")?.trim();
  const VALID_TOD = ["morning", "afternoon", "evening"];
  if (timeOfDayRaw && !VALID_TOD.includes(timeOfDayRaw)) {
    return NextResponse.json({ error: "Invalid timeOfDay value." }, { status: 400 });
  }
  const timeOfDay = timeOfDayRaw as "morning" | "afternoon" | "evening" | undefined;
  // Optional ?radius= (miles around ?zip=), clamped like /api/[state]/search.
  // No default: a zip alone ranks by distance without dropping far colleges.
  const radiusRaw = parseInt(searchParams.get("radius") || "", 10);
  const radius = Number.isFinite(radiusRaw)
    ? Math.max(1, Math.min(radiusRaw, 100))
    : undefined;
  const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") || "10", 10) || 10, 100));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);

  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: "Search query must be at least 2 characters." },
      { status: 400 }
    );
  }

  // Optional ?term=2026FA — validate against the state's actual term list
  // (cached) and ignore unknown values so a stale or hand-typed code doesn't
  // produce empty results without explanation. Default to current term when
  // omitted, preserving existing behavior.
  //
  // The response signals the fallback explicitly via `requestedTerm` /
  // `servedTerm` / `termFallback`. Until 2026-06-01 this fallback was
  // silent: a student following a stale link with ?term=2027SU on a state
  // with no 2027SU rows would see current-term results with no indication
  // their requested term had been swapped. Exposing these fields lets the
  // UI surface a "Spring 2027 had no listed sections — showing Fall 2026
  // instead" note without changing the search behavior.
  const termParamRaw = searchParams.get("term")?.trim();
  const requestedTerm = termParamRaw && termParamRaw.length > 0 ? termParamRaw : null;
  let term: string;
  if (requestedTerm) {
    const available = await getAvailableTerms(state);
    term = available.includes(requestedTerm) ? requestedTerm : await getCurrentTerm(state);
  } else {
    term = await getCurrentTerm(state);
  }
  const termFallback = requestedTerm !== null && requestedTerm !== term;

  const results = await searchCoursesAcrossColleges(
    term,
    q,
    institutions,
    { mode, days, timeOfDay, zip, radius },
    limit,
    offset,
    state
  );

  return NextResponse.json({
    ...results,
    requestedTerm,
    servedTerm: term,
    termFallback,
  });
}
