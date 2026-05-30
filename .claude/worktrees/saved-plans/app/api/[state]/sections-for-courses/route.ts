/**
 * GET /api/{state}/sections-for-courses?codes=BIOL+1010,MATH+1100&term=2026FA
 *
 * Bulk seat-availability lookup for the SemesterPlanner. For each requested
 * (course_prefix, course_number) pair, returns:
 *   - section_count          how many sections offered this term
 *   - total_seats_open       sum of seats_open across those sections
 *   - total_seats_total      sum of seats_total across those sections
 *   - scraped_at             timestamp of the freshest section row (proxy
 *                            for 'last updated'; used by the planner to
 *                            display 'seats as of [timestamp]')
 *   - is_stale               true when scraped_at is >3 days old (matches
 *                            the existing 3-day staleness convention used
 *                            by app/[state]/college/[id]/CollegeTermSection)
 *   - sample_sections        up to 3 representative sections (with college,
 *                            mode, days/times) for UI display
 *
 * Codes that have ZERO sections in the requested term return an entry with
 * section_count: 0 — the planner uses this to render an en-dash badge with
 * a tooltip 'not offered this term'.
 *
 * Codes that the term lookup couldn't resolve to any database row are
 * simply OMITTED from the response. The planner shows no badge for those.
 *
 * Term defaulting: if ?term is omitted or invalid, falls back to the
 * state's current term (same as the search API).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { isValidState } from "@/lib/states/registry";
import { getCurrentTerm } from "@/lib/terms";
import { getAvailableTerms } from "@/lib/courses";

type RouteContext = { params: Promise<{ state: string }> };

// Cap the number of codes per request — a typical plan has 10-30 courses,
// 100 is a very generous ceiling that protects against pathological clients.
const MAX_CODES_PER_REQUEST = 100;
const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

type SectionRow = {
  course_prefix: string;
  course_number: string;
  college_code: string | null;
  crn: string | null;
  seats_open: number | null;
  seats_total: number | null;
  mode: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
};

interface SectionSummary {
  course_code: string;
  section_count: number;
  total_seats_open: number | null;
  total_seats_total: number | null;
  scraped_at: string | null;
  is_stale: boolean;
  sample_sections: Array<{
    college_code: string | null;
    crn: string | null;
    mode: string | null;
    days: string | null;
    start_time: string | null;
    end_time: string | null;
    seats_open: number | null;
    seats_total: number | null;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const { allowed } = rateLimit(getClientKey(request));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = request.nextUrl;
  const codesParam = searchParams.get("codes")?.trim() || "";
  if (!codesParam) {
    return NextResponse.json({ error: "codes parameter is required" }, { status: 400 });
  }

  // Parse "BIOL+1010,MATH+1100,ENGL 101" into [{prefix:"BIOL", number:"1010"}, ...]
  // Accepts +-encoded spaces (URL-safe) or literal spaces.
  const parsed: Array<{ prefix: string; number: string; code: string }> = [];
  const seen = new Set<string>();
  for (const raw of codesParam.split(",")) {
    const normalized = raw.trim().replace(/\+/g, " ").replace(/\s+/g, " ");
    if (!normalized) continue;
    const m = normalized.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]*)$/i);
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    const number = m[2].toUpperCase();
    const code = `${prefix} ${number}`;
    if (seen.has(code)) continue;
    seen.add(code);
    parsed.push({ prefix, number, code });
    if (parsed.length >= MAX_CODES_PER_REQUEST) break;
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      { error: "No valid course codes parsed from 'codes'." },
      { status: 400 },
    );
  }

  // Term defaulting (matches courses/search behavior).
  const termParam = searchParams.get("term")?.trim();
  let term: string;
  if (termParam) {
    const available = await getAvailableTerms(state);
    term = available.includes(termParam) ? termParam : await getCurrentTerm(state);
  } else {
    term = await getCurrentTerm(state);
  }

  // ── One bulk query for ALL requested courses ─────────────────────────────
  // We can't do a "(prefix, number) IN ((a, b), ...)" tuple-IN on PostgREST,
  // but we can pull rows matching the union of prefixes — the candidate set
  // is small (handful of unique prefixes per plan) — then filter to the
  // exact (prefix, number) pairs in memory. This is one round-trip rather
  // than N parallel queries.
  const uniquePrefixes = [...new Set(parsed.map((p) => p.prefix))];
  const allowedPairs = new Set(parsed.map((p) => p.code));
  const PAGE_SIZE = 1000;
  const collected: SectionRow[] = [];

  // Page through results; most plans won't approach the page limit but a
  // popular subject like ENGL in a state with many colleges can exceed it.
  for (let pageStart = 0; pageStart < 5000; pageStart += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("courses")
      .select(
        "course_prefix, course_number, college_code, crn, seats_open, seats_total, mode, days, start_time, end_time, created_at",
      )
      .eq("state", state)
      .eq("term", term)
      .in("course_prefix", uniquePrefixes)
      .range(pageStart, pageStart + PAGE_SIZE - 1);
    if (error) {
      console.error("sections-for-courses query error:", error.message);
      return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const row of data as SectionRow[]) {
      const code = `${row.course_prefix} ${row.course_number}`;
      if (allowedPairs.has(code)) collected.push(row);
    }
    if (data.length < PAGE_SIZE) break;
  }

  // ── Aggregate per course code ────────────────────────────────────────────
  const byCode = new Map<string, SectionRow[]>();
  for (const row of collected) {
    const code = `${row.course_prefix} ${row.course_number}`;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(row);
  }

  const now = Date.now();
  const summaries: SectionSummary[] = parsed.map(({ code }) => {
    const rows = byCode.get(code) ?? [];
    if (rows.length === 0) {
      return {
        course_code: code,
        section_count: 0,
        total_seats_open: null,
        total_seats_total: null,
        scraped_at: null,
        is_stale: false,
        sample_sections: [],
      };
    }

    let seatsOpenSum = 0;
    let seatsTotalSum = 0;
    let hadOpen = false;
    let hadTotal = false;
    let freshest = 0;
    for (const r of rows) {
      if (r.seats_open != null) {
        seatsOpenSum += r.seats_open;
        hadOpen = true;
      }
      if (r.seats_total != null) {
        seatsTotalSum += r.seats_total;
        hadTotal = true;
      }
      const t = new Date(r.created_at).getTime();
      if (t > freshest) freshest = t;
    }

    const sample_sections = rows.slice(0, 3).map((r) => ({
      college_code: r.college_code,
      crn: r.crn,
      mode: r.mode,
      days: r.days,
      start_time: r.start_time,
      end_time: r.end_time,
      seats_open: r.seats_open,
      seats_total: r.seats_total,
    }));

    return {
      course_code: code,
      section_count: rows.length,
      total_seats_open: hadOpen ? seatsOpenSum : null,
      total_seats_total: hadTotal ? seatsTotalSum : null,
      scraped_at: freshest > 0 ? new Date(freshest).toISOString() : null,
      is_stale: freshest > 0 ? now - freshest > STALE_THRESHOLD_MS : false,
      sample_sections,
    };
  });

  return NextResponse.json(
    { term, courses: summaries },
    {
      // Cache-friendly: seats change but the cron-driven scrape is ~daily, so
      // a short cache + stale-while-revalidate gives a fast typical-case
      // response without making the data wildly stale.
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
    },
  );
}
