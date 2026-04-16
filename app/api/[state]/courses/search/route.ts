import { NextRequest, NextResponse } from "next/server";
import { searchCoursesAcrossColleges } from "@/lib/courses-search";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";
import { getCurrentTerm } from "@/lib/terms";

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
  const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") || "10", 10) || 10, 100));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);

  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: "Search query must be at least 2 characters." },
      { status: 400 }
    );
  }

  const results = await searchCoursesAcrossColleges(
    await getCurrentTerm(state),
    q,
    institutions,
    { mode, days, timeOfDay, zip },
    limit,
    offset,
    state
  );

  return NextResponse.json(results);
}
