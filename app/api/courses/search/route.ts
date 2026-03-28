import { NextRequest, NextResponse } from "next/server";
import { searchCoursesAcrossColleges } from "@/lib/courses";
import institutionsData from "@/data/institutions.json";
import type { Institution } from "@/lib/types";

const institutions = institutionsData as Institution[];
const CURRENT_TERM = "2026SP";

export async function GET(request: NextRequest) {
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
    CURRENT_TERM,
    q,
    institutions,
    { mode, day, timeOfDay, zip },
    limit,
    offset
  );

  return NextResponse.json(results);
}
