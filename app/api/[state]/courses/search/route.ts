import { NextRequest, NextResponse } from "next/server";
import { searchCoursesAcrossColleges } from "@/lib/courses";
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
  const day = searchParams.get("day")?.trim() || undefined;
  const timeOfDay = searchParams.get("timeOfDay")?.trim() as
    | "morning"
    | "afternoon"
    | "evening"
    | undefined;
  const limit = parseInt(searchParams.get("limit") || "10", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

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
    { mode, day, timeOfDay, zip },
    limit,
    offset,
    state
  );

  return NextResponse.json(results);
}
