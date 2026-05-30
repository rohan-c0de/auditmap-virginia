import { NextRequest, NextResponse } from "next/server";
import { isValidState } from "@/lib/states/registry";
import fs from "fs";
import path from "path";

type RouteContext = { params: Promise<{ state: string }> };

/**
 * GET /api/[state]/prereqs/courses
 *
 * Returns all courses available in the prereqs.json file for a state,
 * useful for autocomplete in the semester planner.
 *
 * Response: { courses: [{ code: "MATH 1130", text: "...", prereqs: ["MATH 1030"] }] }
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const jsonPath = path.join(process.cwd(), "data", state, "prereqs.json");
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<
      string,
      { text: string; courses: string[] }
    >;

    const courses = Object.entries(raw).map(([code, data]) => ({
      code,
      text: data.text,
      prereqs: data.courses,
    }));

    return NextResponse.json(
      { courses },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "No prerequisite data available for this state" },
      { status: 404 },
    );
  }
}
