import { NextResponse } from "next/server";
import type { ScheduleRequest } from "@/lib/types";
import { generateSchedules } from "@/lib/schedule";
import { buildTransferLookupForSubjects } from "@/lib/transfer-scoped";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";

type RouteContext = { params: Promise<{ state: string }> };

export async function POST(req: Request, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }
  const { allowed } = rateLimit(getClientKey(req), 20);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  try {
    const body = await req.json();

    // Validate required fields
    if (
      !body.subjects ||
      !Array.isArray(body.subjects) ||
      body.subjects.length === 0
    ) {
      return NextResponse.json(
        { error: "At least one subject is required." },
        { status: 400 }
      );
    }

    if (!body.subjects.every((s: unknown) => typeof s === "string")) {
      return NextResponse.json(
        { error: "All subjects must be strings." },
        { status: 400 }
      );
    }

    if (
      !body.daysAvailable ||
      !Array.isArray(body.daysAvailable) ||
      body.daysAvailable.length === 0
    ) {
      return NextResponse.json(
        { error: "At least one available day is required." },
        { status: 400 }
      );
    }

    const VALID_DAYS = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];
    if (!body.daysAvailable.every((d: unknown) => typeof d === "string" && VALID_DAYS.includes(d))) {
      return NextResponse.json(
        { error: "Invalid day value." },
        { status: 400 }
      );
    }

    const maxCourses = body.maxCourses || 2;
    if (![1, 2, 3, 4, 5].includes(maxCourses)) {
      return NextResponse.json(
        { error: "maxCourses must be 1–5." },
        { status: 400 }
      );
    }

    const request: ScheduleRequest = {
      subjects: body.subjects.map((s: string) => s.trim()).filter(Boolean),
      daysAvailable: body.daysAvailable,
      timeWindowStart: body.timeWindowStart || "morning",
      timeWindowEnd: body.timeWindowEnd || "evening",
      maxCourses: maxCourses as 1 | 2 | 3 | 4 | 5,
      zip: body.zip || undefined,
      maxDistance: body.maxDistance ?? undefined,
      mode: body.mode || "any",
      minBreakMinutes: body.minBreakMinutes ?? 0,
      includeInProgress: body.includeInProgress ?? false,
      targetUniversity: body.targetUniversity || undefined,
      hideFullSections: body.hideFullSections ?? true,
      term: body.term || undefined,
    };

    const institutions = loadInstitutions(state);

    // Load transfer lookup if a target university is specified. Scoped to the
    // user's chosen subjects so we don't pull the whole state catalog just to
    // discard 70-90% of it.
    let transferLookup = null;
    if (request.targetUniversity) {
      try {
        transferLookup = await buildTransferLookupForSubjects(
          request.subjects,
          state
        );
      } catch {
        // Transfer data unavailable — continue without it
      }
    }

    const result = await generateSchedules(
      request,
      institutions,
      state,
      transferLookup,
      request.targetUniversity || null
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Schedule build error:", error);
    return NextResponse.json(
      { error: "Failed to generate schedules." },
      { status: 500 }
    );
  }
}
