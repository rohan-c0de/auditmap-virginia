// Edge-safe scoped transfer-lookup builders. This file deliberately does not
// import `fs`/`path` or anything from `lib/transfer.ts` — keeping those
// Node-only modules out of the edge bundle for the
// `/api/[state]/college/[id]/courses/[prefix]` route.
//
// Callers that only need a lookup scoped to a handful of courses or subjects
// should use these helpers instead of `buildTransferLookup(state)`, which
// loads the entire state catalog (5.7 MB VA, 51 MB NJ/MD).

import { supabase } from "./supabase";

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

// Max (prefix, number) pairs per Supabase `.or(...)` request. Each clause is
// ~40 chars, URL-encoded; PostgREST rejects URLs past ~4-8 KB depending on
// proxy config. 100 pairs ≈ 4 KB of `.or()` payload — safely under the limit.
// Larger inputs (college-page union with thousands of courses) are split into
// parallel chunks.
const CHUNK_SIZE = 100;

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
  const pairArr = Array.from(pairs.values());

  const chunks: (typeof pairArr)[] = [];
  for (let i = 0; i < pairArr.length; i += CHUNK_SIZE) {
    chunks.push(pairArr.slice(i, i + CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      const orClauses = chunk
        .map(
          (p) =>
            `and(cc_prefix.eq.${encodeURIComponent(p.prefix)},cc_number.eq.${encodeURIComponent(p.number)})`
        )
        .join(",");
      const { data, error } = await supabase
        .from("transfers")
        .select(
          "cc_prefix, cc_number, university, univ_course, is_elective, no_credit"
        )
        .eq("state", state)
        .or(orClauses);
      if (error) {
        console.error("buildTransferLookupForCourses error:", error.message);
        return [] as TransferRow[];
      }
      return (data ?? []) as TransferRow[];
    })
  );

  return rowsToLookup(chunkResults.flat());
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
}
