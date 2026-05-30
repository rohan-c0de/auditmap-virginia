// GET /api/[state]/ask?q=<query>
//
// The natural-language question endpoint. Pipeline:
//
//   1. Validate state slug + rate limit + query length.
//   2. classifyQuery(q)    — LLM classifier with Supabase cache (PR 2).
//   3. lookupAnswer(...)   — entity validation + structured answer (PR 3).
//   4. Respond with { classification, answer }.
//
// Failure modes:
//   - 400: missing or too-short ?q=
//   - 404: invalid state slug
//   - 429: rate-limited
//   - 503: classifier threw (Anthropic outage, missing key, etc.)
//          The UI in PR 5 treats 5xx as "no answer card" and falls back
//          to the existing course search results — graceful degradation.
//
// Caching: this endpoint is deterministic given (state, q). Same query
// always produces the same answer (until underlying data updates), so
// the CDN can hold it for an hour.

import { NextRequest, NextResponse } from "next/server";
import { isValidState } from "@/lib/states/registry";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { classifyQuery } from "@/lib/search-intent/classify";
import { lookupAnswers } from "@/lib/search-intent/answer";

type RouteContext = { params: Promise<{ state: string }> };

// LLM calls cost real money, so keep the per-IP cap tighter than the
// course-search endpoint's 30/min default.
const ASK_RATE_LIMIT = 15;

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 500;

export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const { allowed, remaining } = rateLimit(getClientKey(request), ASK_RATE_LIMIT);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query must be at least ${MIN_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query must be at most ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  let classification;
  try {
    classification = await classifyQuery(q, state);
  } catch (err) {
    // Anthropic outage, missing key, billing issue, network error, etc.
    // Log server-side, return 503 so the UI knows to skip the answer card.
    console.error("[ask] classifier failed:", err);
    return NextResponse.json(
      {
        error: "Classifier service unavailable.",
        // Surface the high-level cause without leaking stack details.
        cause: err instanceof Error ? err.message : "unknown",
      },
      { status: 503 },
    );
  }

  const { primary: answer, secondary: secondaryAnswer } = await lookupAnswers(
    classification,
    state,
  );

  return NextResponse.json(
    { classification, answer, secondaryAnswer },
    {
      headers: {
        // Same query → same answer until data updates. Browser holds 5
        // minutes; CDN holds 1 hour.
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "X-RateLimit-Remaining": String(remaining),
      },
    },
  );
}
