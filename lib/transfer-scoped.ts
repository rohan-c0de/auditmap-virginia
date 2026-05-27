// Edge-safe scoped transfer-lookup builders. This file deliberately does not
// import `fs`/`path` or anything from `lib/transfer.ts` — keeping those
// Node-only modules out of the edge bundle for the
// `/api/[state]/college/[id]/courses/[prefix]` route.
//
// Callers that only need a lookup scoped to a handful of courses or subjects
// should use these helpers instead of `buildTransferLookup(state)`, which
// loads the entire state catalog (5.7 MB VA, 51 MB NJ/MD).

import { supabase } from "./supabase";
import { runPooled } from "./concurrency";

// ---------------------------------------------------------------------------
// In-memory TTL cache + inflight dedup (same pattern as lib/courses.ts)
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expires > Date.now()) return entry.data;

  // Deduplicate concurrent requests for the same key
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn()
    .then((data) => {
      cache.set(key, { data, expires: Date.now() + CACHE_TTL });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Client-side lookup shape: `"ENG-111" → [{ university, type, course }, …]`.
 */
export type TransferLookup = Record<
  string,
  {
    university: string;
    type: "direct" | "elective" | "no-credit";
    course: string;
  }[]
>;

type TransferRow = {
  cc_prefix: string;
  cc_number: string;
  university: string;
  univ_course: string | null;
  is_elective: boolean | null;
  no_credit: boolean | null;
};

function rowsToLookup(rows: TransferRow[]): TransferLookup {
  const lookup: TransferLookup = {};
  for (const m of rows) {
    // Skip combo-credit entries (e.g. ODU's "**** ****") — they only transfer
    // when paired with other courses, not standalone.
    if (m.univ_course && m.univ_course.includes("*")) continue;
    const key = `${m.cc_prefix}-${m.cc_number}`;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push({
      university: m.university,
      type: m.no_credit ? "no-credit" : m.is_elective ? "elective" : "direct",
      course: m.univ_course || "",
    });
  }
  return lookup;
}

// Max course numbers per prefix-scoped `.in(...)` query. Keeps each request's
// URL well under PostgREST's ~4-8 KB ceiling and gives the planner a tight
// range to scan against idx_transfers_state_course (state, cc_prefix, cc_number).
const NUMBERS_PER_PREFIX_CHUNK = 200;

/**
 * Build a transfer lookup scoped to a specific set of (course_prefix,
 * course_number) pairs. For large inputs, fans out the request into parallel
 * chunked Supabase `.or()` queries to stay under PostgREST's URL length limit.
 *
 * Used by the college page and subject page server-side to build a transfer
 * lookup for only the courses actually on the page. Shared with the edge
 * route `/api/[state]/college/[id]/courses/[prefix]`.
 */
export async function buildTransferLookupForCourses(
  courses: { course_prefix: string; course_number: string }[],
  state: string
): Promise<TransferLookup> {
  if (courses.length === 0) return {};

  // Dedup (prefix, number) pairs
  const pairs = new Map<string, { prefix: string; number: string }>();
  for (const c of courses) {
    pairs.set(`${c.course_prefix}-${c.course_number}`, {
      prefix: c.course_prefix,
      number: c.course_number,
    });
  }

  // Stable cache key: sorted pair keys so the same set of courses always
  // hits the same cache entry regardless of input order.
  const cacheKey = `xfer-courses:${state}:${Array.from(pairs.keys()).sort().join("|")}`;

  return cached(cacheKey, async () => {
    // Group requested pairs by prefix so each query hits the compound index
    // (state, cc_prefix, cc_number) as a clean per-prefix range scan.
    // Long OR-chains of `and(cc_prefix.eq.X,cc_number.eq.Y)` planned poorly
    // at scale (issue #44).
    const byPrefix = new Map<string, Set<string>>();
    for (const p of pairs.values()) {
      let nums = byPrefix.get(p.prefix);
      if (!nums) {
        nums = new Set();
        byPrefix.set(p.prefix, nums);
      }
      nums.add(p.number);
    }

    const queries: { prefix: string; numbers: string[] }[] = [];
    for (const [prefix, numSet] of byPrefix) {
      const numbers = Array.from(numSet);
      for (let i = 0; i < numbers.length; i += NUMBERS_PER_PREFIX_CHUNK) {
        queries.push({
          prefix,
          numbers: numbers.slice(i, i + NUMBERS_PER_PREFIX_CHUNK),
        });
      }
    }

    // Concurrency-cap the per-prefix queries — large colleges fan out to
    // 20+ subject prefixes, and `next build` runs this on many pages in
    // parallel. Unbounded Promise.all here was a major contributor to
    // pgbouncer connection-pool exhaustion during deploy. Cap of 5 keeps
    // peak connections per call modest while staying fast in practice.
    const chunkResults = await runPooled(
      queries.map(({ prefix, numbers }) => async () => {
        const { data, error } = await supabase
          .from("transfers")
          .select(
            "cc_prefix, cc_number, university, univ_course, is_elective, no_credit"
          )
          .eq("state", state)
          .eq("cc_prefix", prefix)
          .in("cc_number", numbers);
        if (error) {
          console.error("buildTransferLookupForCourses error:", error.message);
          return [] as TransferRow[];
        }
        return (data ?? []) as TransferRow[];
      }),
      5
    );

    return rowsToLookup(chunkResults.flat());
  });
}

/**
 * Build a transfer lookup scoped to a set of subject prefixes. For callers
 * that know which subjects but not which course numbers yet (e.g. schedule
 * builder before candidate section generation). Narrower than
 * `buildTransferLookup(state)` — typically 10–30% of the full state catalog.
 */
export async function buildTransferLookupForSubjects(
  subjectPrefixes: string[],
  state: string
): Promise<TransferLookup> {
  if (subjectPrefixes.length === 0) return {};

  const sorted = [...subjectPrefixes].sort();
  const cacheKey = `xfer-subjects:${state}:${sorted.join("|")}`;

  return cached(cacheKey, async () => {
    const { data, error } = await supabase
      .from("transfers")
      .select(
        "cc_prefix, cc_number, university, univ_course, is_elective, no_credit"
      )
      .eq("state", state)
      .in("cc_prefix", subjectPrefixes);

    if (error) {
      console.error("buildTransferLookupForSubjects error:", error.message);
      return {};
    }
    return rowsToLookup((data ?? []) as TransferRow[]);
  });
}
