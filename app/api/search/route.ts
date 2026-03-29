import { NextRequest, NextResponse } from "next/server";
import { resolveLocation, findNearbyInstitutions } from "@/lib/geo";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import type { Institution } from "@/lib/types";
import institutionsData from "@/data/institutions.json";

const institutions = institutionsData as Institution[];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("zip") || searchParams.get("q") || "";
  const radius = parseInt(searchParams.get("radius") || "25", 10);

  if (!query.trim()) {
    return NextResponse.json(
      { error: "Please provide a zip code or city name." },
      { status: 400 }
    );
  }

  const location = resolveLocation(query);
  if (!location) {
    return NextResponse.json(
      {
        error: `"${query}" not found in our Virginia database. Try a 5-digit zip code or a Virginia city name.`,
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
    courseCount: getCourseCount(result.institution.vccs_slug, getCurrentTerm()),
  }));

  return NextResponse.json({
    results: resultsWithCounts,
    center: { lat: location.lat, lng: location.lng },
    city: location.city,
    zip: location.zip,
    radius,
    term: getCurrentTerm(),
  });
}
