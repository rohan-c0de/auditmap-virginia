import { NextRequest, NextResponse } from "next/server";
import { resolveLocation, findNearbyInstitutions } from "@/lib/geo";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import { loadInstitutions } from "@/lib/institutions";
import { getStateConfig, isValidState } from "@/lib/states/registry";

type RouteContext = { params: Promise<{ state: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("zip") || searchParams.get("q") || "";
  const radius = parseInt(searchParams.get("radius") || "25", 10);

  if (!query.trim()) {
    return NextResponse.json(
      { error: "Please provide a zip code or city name." },
      { status: 400 }
    );
  }

  const location = resolveLocation(query, state);
  if (!location) {
    return NextResponse.json(
      {
        error: `"${query}" not found in our ${config.name} database. Try a 5-digit zip code or a ${config.name} city name.`,
      },
      { status: 404 }
    );
  }

  const results = findNearbyInstitutions(
    location.lat,
    location.lng,
    radius,
    institutions
  );

  // Populate course counts
  const resultsWithCounts = results.map((result) => ({
    ...result,
    courseCount: getCourseCount(result.institution.college_slug, getCurrentTerm(state), state),
  }));

  return NextResponse.json({
    results: resultsWithCounts,
    center: { lat: location.lat, lng: location.lng },
    city: location.city,
    zip: location.zip,
    radius,
    term: getCurrentTerm(state),
  });
}
