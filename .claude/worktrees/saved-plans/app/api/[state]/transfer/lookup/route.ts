import { NextRequest, NextResponse } from "next/server";
import { buildTransferLookup, getUniversities } from "@/lib/transfer";
import { isValidState } from "@/lib/states/registry";

// Cache per state with TTL since transfer data changes infrequently
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const cachedResponses: Record<string, { json: string; expires: number }> = {};

type RouteContext = { params: Promise<{ state: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const cached = cachedResponses[state];
  if (!cached || Date.now() > cached.expires) {
    try {
      const lookup = await buildTransferLookup(state);
      const universities = await getUniversities(state);
      cachedResponses[state] = {
        json: JSON.stringify({ lookup, universities }),
        expires: Date.now() + CACHE_TTL,
      };
    } catch (err) {
      console.error(`Transfer lookup error for ${state}:`, err);
      return NextResponse.json({ error: "Failed to load transfer data." }, { status: 500 });
    }
  }

  return new NextResponse(cachedResponses[state].json, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600", // 1h CDN cache
    },
  });
}
