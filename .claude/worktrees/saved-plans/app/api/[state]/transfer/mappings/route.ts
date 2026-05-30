import { NextRequest, NextResponse } from "next/server";
import { loadTransferMappingsByUniversity } from "@/lib/transfer";
import { isValidState } from "@/lib/states/registry";

type RouteContext = {
  params: Promise<{ state: string }>;
};

/**
 * Returns transfer mappings for a single university.
 * Used by TransferClient to lazy-fetch data when the user switches
 * universities, avoiding the cost of shipping all state mappings
 * (~7 MB for VA) in the initial RSC payload.
 *
 * GET /api/{state}/transfer/mappings?university={slug}
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const university = request.nextUrl.searchParams.get("university")?.trim();
  if (!university) {
    return NextResponse.json({ error: "Missing university" }, { status: 400 });
  }

  const mappings = await loadTransferMappingsByUniversity(state, university);

  return NextResponse.json(
    { mappings },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
