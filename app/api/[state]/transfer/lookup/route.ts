import { NextRequest, NextResponse } from "next/server";
import { buildTransferLookup, getUniversities } from "@/lib/transfer";
import { isValidState } from "@/lib/states/registry";

// Cache per state since transfer data changes infrequently
const cachedResponses: Record<string, string> = {};

type RouteContext = { params: Promise<{ state: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  if (!cachedResponses[state]) {
    const lookup = buildTransferLookup(state);
    const universities = getUniversities(state);
    cachedResponses[state] = JSON.stringify({ lookup, universities });
  }

  return new NextResponse(cachedResponses[state], {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400", // 24h cache
    },
  });
}
