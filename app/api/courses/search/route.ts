import { NextRequest, NextResponse } from "next/server";
import { searchCoursesAcrossColleges } from "@/lib/courses";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import institutionsData from "@/data/institutions.json";
import type { Institution } from "@/lib/types";

import { getCurrentTerm } from "@/lib/terms";

const institutions = institutionsData as Institution[];

export async function GET(request: NextRequest) {
  const { allowed, remaining } = rateLimit(getClientKey(request));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60", "X-RateLimit-Remaining": "0" } }
    );
  }

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

  const results = searchCoursesAcrossColleges(
    getCurrentTerm(),
    q,
    institutions,
    { mode, day, timeOfDay, zip },
    limit,
    offset
  );

  return NextResponse.json(results);
}
