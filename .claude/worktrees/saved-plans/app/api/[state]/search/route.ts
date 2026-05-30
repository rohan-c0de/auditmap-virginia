import { NextRequest, NextResponse } from "next/server";
import { resolveLocation, findNearbyInstitutions } from "@/lib/geo";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import { loadInstitutions } from "@/lib/institutions";
import { getStateConfig, isValidState } from "@/lib/states/registry";
import { rateLimit, getClientKey } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ state: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const { allowed } = rateLimit(getClientKey(request), 30);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("zip") || searchParams.get("q") || "";
  const radius = Math.max(1, Math.min(parseInt(searchParams.get("radius") || "25", 10) || 25, 100));

  if (!query.trim()) {
    return NextResponse.json(
      { error: "Please provide a zip code or city name." },
      { status: 400 }
    );
  }

  const safeQuery = query.replace(/[<>"'&]/g, "");

  const location = resolveLocation(query, state);
  if (!location) {
    return NextResponse.json(
      {
        error: `"${safeQuery}" not found in our ${config.name} database. Try a 5-digit zip code or a ${config.name} city name.`,
      },
      { status: 404 }
    );
  }

  try {
    const results = findNearbyInstitutions(
      location.lat,
      location.lng,
      radius,
      institutions
    );

    // Populate course counts
    const currentTerm = await getCurrentTerm(state);
    const resultsWithCounts = await Promise.all(
      results.map(async (result) => ({
        ...result,
        courseCount: await getCourseCount(result.institution.college_slug, currentTerm, state),
      }))
    );

    return NextResponse.json({
      results: resultsWithCounts,
      center: { lat: location.lat, lng: location.lng },
      city: location.city,
      zip: location.zip,
      radius,
      term: currentTerm,
    });
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json(
      { error: "Search failed. Please try again." },
      { status: 500 }
    );
  }
}
