import fs from "fs";
import path from "path";
import { unstable_cache } from "next/cache";
import type { TransferMapping, TransferMappingClient } from "./types";
import { supabase } from "./supabase";
import { cached } from "./courses";
import { collapseDuplicateMappings } from "./transfer-rank";

/**
 * Hard cap on mappings passed to the client on a single transfer-hub page.
 * Protects against Vercel's 19 MB ISR pre-render payload limit for
 * universities with huge mapping counts (UMGC ~39k, Frostburg ~23k, UMBC ~17k).
 * Most user queries narrow by subject and won't hit this ceiling.
 */
export const TRANSFER_HUB_MAX_CLIENT_MAPPINGS = 2500;

/**
 * Upper bound on rows the hub page FETCHES to build its table + subject sample.
 * The table is round-robin-capped to TRANSFER_HUB_MAX_CLIENT_MAPPINGS for
 * display, so we never need every row — but we pull a larger pool than the
 * display cap so the round-robin still has subjects to spread across. The
 * CSU/UC system-wide pages (~99K / ~56K mappings) would otherwise load ~30 MB
 * and time out (issue tracked after #1208). The page's headline direct/elective
 * /total counts come from the transfer-universities.json cache instead, so
 * capping the fetched sample only changes WHICH courses appear in the browsable
 * table — never the totals. Universities at/under this cap fetch every row.
 */
export const TRANSFER_HUB_SAMPLE_FETCH = 12000;

/**
 * Strip redundant fields before serializing to the client. On pages with
 * many thousands of mappings, these per-row fields add up to several MB
 * of wire payload for no user-visible benefit.
 */
export function trimMappingsForClient(
  mappings: TransferMapping[]
): TransferMappingClient[] {
  const out: TransferMappingClient[] = new Array(mappings.length);
  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    out[i] = {
      cc_prefix: m.cc_prefix,
      cc_number: m.cc_number,
      cc_title: m.cc_title,
      cc_credits: m.cc_credits,
      univ_course: m.univ_course,
      univ_title: m.univ_title,
      notes: m.notes,
      is_elective: m.is_elective,
    };
  }
  return out;
}

/**
 * Cap mapping count via round-robin across `cc_prefix` buckets, so every
 * subject that exists in the dataset is represented in the capped output.
 *
 * If we simply sliced the top N after an alphabetical sort, universities
 * with tens of thousands of mappings (e.g. UMGC) would drop every subject
 * starting past roughly letter "M" — so the client-side subject filter
 * would silently not show those subjects at all. Round-robin preserves
 * subject diversity at the cost of depth within each subject.
 *
 * Input is assumed to already be sorted by (cc_prefix, cc_number) so that
 * each bucket's retained rows are in a stable order.
 */
export function capMappingsByRoundRobin(
  mappings: TransferMapping[],
  cap: number
): TransferMapping[] {
  if (mappings.length <= cap) return mappings;
  const buckets = new Map<string, TransferMapping[]>();
  for (const m of mappings) {
    const key = m.cc_prefix;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(m);
  }
  const queues = Array.from(buckets.values());
  const out: TransferMapping[] = [];
  let i = 0;
  while (out.length < cap) {
    let tookAny = false;
    for (const q of queues) {
      if (q.length > i) {
        out.push(q[i]);
        tookAny = true;
        if (out.length >= cap) break;
      }
    }
    if (!tookAny) break;
    i++;
  }
  return out;
}

function dataPath(state: string): string {
  return path.join(process.cwd(), "data", state, "transfer-equiv.json");
}

// Module-level cache (keyed by state)
const transferCache: Record<string, TransferMapping[]> = {};

// Supabase default max rows per request is 1,000 — PAGE_SIZE must not
// exceed that or the pagination loop will exit early, loading only a
// partial dataset.
const PAGE_SIZE = 1000;

/**
 * Load transfer mappings for a single university from Supabase.
 * Used by the transfer page API route to avoid sending the full state
 * dataset (~15 K rows) as the initial RSC payload.
 */
export async function loadTransferMappingsByUniversity(
  state: string,
  university: string,
  /**
   * Optional cap. When set, stops paginating after this many rows.
   * The transfer page's initial server-side payload caps to
   * TRANSFER_HUB_MAX_CLIENT_MAPPINGS anyway, so loading all 99K CSU rows
   * just to throw most of them away costs ~50s on Vercel (issue #777).
   */
  cap?: number
): Promise<TransferMapping[]> {
  // Two cache layers, both keyed by (state, university, cap):
  //   1. in-memory `cached()` — intra-instance dedup + fast warm hits, and a
  //      safety net for results too large for the cross-instance Data Cache's
  //      ~2 MB item limit (huge universities), which unstable_cache silently
  //      skips caching.
  //   2. unstable_cache (below) — Vercel Data Cache, shared ACROSS serverless
  //      instances so cold starts don't re-query Postgres. This is the gap the
  //      in-memory-only cache (PR #1075) left: under crawler load Vercel spins
  //      up many short-lived instances, each previously a fresh cache miss.
  // This loader backs the force-dynamic /[state]/transfer route and was the
  // single heaviest egress source (~13.4M calls, ~50% of DB egress — the
  // 485/250 GB quota overage).
  return cached(
    `transfer-by-university:${state}:${university}:${cap ?? "all"}`,
    () => _xInstanceTransfersByUniversity(state, university, cap),
  );
}

// Cross-instance persistent cache (Vercel Data Cache). revalidate 1800s (30m)
// matches the in-memory CACHE_TTL and is well within the ~3×/week scrape
// cadence. unstable_cache keys on the function arguments automatically; the
// keyParts entry is just a stable namespace. Only the transfers loader gets
// this — the courses loaders run inside build scripts (no Next cache context),
// whereas this loader is only ever called from Next routes (verified).
const _xInstanceTransfersByUniversity = unstable_cache(
  (state: string, university: string, cap?: number) =>
    _loadTransferMappingsByUniversity(state, university, cap),
  ["transfer-by-university"],
  { revalidate: 1800, tags: ["transfers"] },
);

async function _loadTransferMappingsByUniversity(
  state: string,
  university: string,
  cap?: number
): Promise<TransferMapping[]> {
  let supabaseFailed = false;
  try {
    const allData: TransferMapping[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const pageSize = cap ? Math.min(PAGE_SIZE, cap - allData.length) : PAGE_SIZE;
      if (pageSize <= 0) break;
      const { data, error } = await supabase
        .from("transfers")
        .select(
          "cc_prefix, cc_number, cc_course, cc_title, cc_credits, university, university_name, univ_course, univ_title, univ_credits, notes, no_credit, is_elective"
        )
        .eq("state", state)
        .eq("university", university)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allData.push(...(data as TransferMapping[]));
      hasMore = data.length === pageSize && (!cap || allData.length < cap);
      offset += pageSize;
    }

    // Same duplicate-row safety net as getTransferInfo — Supabase mirrors the
    // scraped JSON, so a dup-laden scrape would otherwise reach every
    // per-university surface (browse list, /transfer/to pages, plans).
    if (allData.length > 0) return collapseDuplicateMappings(allData);
    // Supabase succeeded but returned 0 rows: a legitimately-empty result.
    // Fall through to the JSON fallback (dev may have local data Supabase lacks).
  } catch {
    // Supabase errored — fall through to the local JSON fallback.
    supabaseFailed = true;
  }

  // Fallback: filter from the full local JSON
  const all = await loadTransferMappings(state);
  const filtered = collapseDuplicateMappings(
    all.filter((m) => m.university === university)
  );
  const result = cap ? filtered.slice(0, cap) : filtered;

  // Cache-poisoning guard: if Supabase ERRORED and the fallback also produced
  // nothing (in prod the JSON is excluded from the serverless bundle, so the
  // fallback always returns []), do NOT return an empty array — both cache
  // layers (in-memory `cached()` and cross-instance `unstable_cache`) would
  // then pin that empty result for the full 30-min TTL and serve a "no transfer
  // mappings" lie long after Supabase recovers (seconds later). Throwing
  // instead: `cached()` rethrows without caching and `unstable_cache` skips
  // caching on throw, so the next request retries. A genuinely-empty university
  // (Supabase OK, 0 rows, fallback empty) is NOT a failure and returns [] above
  // via `supabaseFailed === false`.
  if (supabaseFailed && result.length === 0) {
    throw new Error(
      `transfers unavailable for ${state}/${university}: Supabase errored and no fallback data`
    );
  }
  return result;
}

// Shared column list — kept identical across loaders so callers get a
// uniform TransferMapping shape.
const TRANSFER_COLUMNS =
  "cc_prefix, cc_number, cc_course, cc_title, cc_credits, university, university_name, univ_course, univ_title, univ_credits, notes, no_credit, is_elective";

// Chunk size for the compound .or() filter. Each tuple encodes to ~40 chars
// (`and(cc_prefix.eq.XX,cc_number.eq.NNN)`); 100 stays comfortably under
// PostgREST's ~8KB practical URL ceiling.
const COURSE_FILTER_CHUNK = 100;

// Whitelist of characters allowed inside a single course token (cc_prefix
// or cc_number) when it's interpolated into a PostgREST .or() filter.
// Letters / digits / hyphen cover every real course code we've seen in
// scraped catalog data; any other character (comma, paren, period, quote,
// whitespace, empty) gets the row skipped — never interpolated raw, where
// it could split the compound filter and silently corrupt the query.
const COURSE_TOKEN_RE = /^[A-Z0-9-]+$/i;

/**
 * Load transfer mappings for a specific set of CC courses in a single
 * (or few) targeted Supabase queries — instead of pulling the entire
 * state's mappings and filtering in memory.
 *
 * Replaces `loadTransferMappings(state)` for callers that already know
 * which `(cc_prefix, cc_number)` pairs they need. Critical for CA, where
 * the state-wide loader pages through ~162k rows (~15s) just to use ~30.
 *
 * Backed by `idx_transfers_state_course` on `(state, cc_prefix, cc_number)`
 * — see `EXPLAIN ANALYZE` in PR #N description (~5ms server-side for ~10
 * courses on the CA dataset).
 */
export async function loadTransferMappingsForCourses(
  state: string,
  courses: ReadonlyArray<{ prefix: string; number: string }>,
): Promise<TransferMapping[]> {
  if (courses.length === 0) return [];

  // Dedupe + sanitize. Each (prefix, number) is trimmed and validated against
  // COURSE_TOKEN_RE before going into the .or() filter — otherwise a scraped
  // course code containing a comma, paren, period, quote, or whitespace would
  // be interpolated raw and silently corrupt PostgREST's parsing of the
  // compound filter (commas split tuples, parens close `and(...)` early, etc.).
  // Trimming also aligns with planner's joinKey() so a stored "CS " doesn't
  // miss its "CS" mapping.
  const seen = new Set<string>();
  const unique: Array<{ prefix: string; number: string }> = [];
  for (const c of courses) {
    const prefix = c.prefix.trim();
    const number = c.number.trim();
    if (!COURSE_TOKEN_RE.test(prefix) || !COURSE_TOKEN_RE.test(number)) {
      // eslint-disable-next-line no-console
      console.warn(
        `loadTransferMappingsForCourses: skipping unsafe course token`,
        { state, prefix: c.prefix, number: c.number },
      );
      continue;
    }
    const key = `${prefix}|${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ prefix, number });
  }
  if (unique.length === 0) return [];

  const out: TransferMapping[] = [];
  for (let i = 0; i < unique.length; i += COURSE_FILTER_CHUNK) {
    const batch = unique.slice(i, i + COURSE_FILTER_CHUNK);
    const orFilter = batch
      .map((c) => `and(cc_prefix.eq.${c.prefix},cc_number.eq.${c.number})`)
      .join(",");
    const { data, error } = await supabase
      .from("transfers")
      .select(TRANSFER_COLUMNS)
      .eq("state", state)
      .or(orFilter);
    if (error) throw error;
    if (data) out.push(...(data as TransferMapping[]));
  }
  return out;
}

/**
 * Load all transfer mappings from Supabase (with local JSON fallback).
 * Cached after first load.
 */
export async function loadTransferMappings(
  state: string
): Promise<TransferMapping[]> {
  if (transferCache[state]) return transferCache[state];

  // Try Supabase first
  try {
    const allData: TransferMapping[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("transfers")
        .select(
          "cc_prefix, cc_number, cc_course, cc_title, cc_credits, university, university_name, univ_course, univ_title, univ_credits, notes, no_credit, is_elective"
        )
        .eq("state", state)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allData.push(...(data as TransferMapping[]));
      hasMore = data.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    if (allData.length > 0) {
      transferCache[state] = allData;
      return allData;
    }
  } catch {
    // Supabase unavailable or table doesn't exist yet — fall through
  }

  // Fallback to local JSON file
  try {
    const raw = fs.readFileSync(dataPath(state), "utf-8");
    const data = JSON.parse(raw) as TransferMapping[];
    transferCache[state] = data;
    return data;
  } catch {
    return [];
  }
}

/** Get all transfer mappings for a specific community college course.
 *
 * Collapses duplicate articulation rows per (university, equivalent course),
 * keeping the best outcome — see collapseDuplicateMappings. Without this, a
 * scrape that misses pipeline dedup renders the same row dozens of times on
 * the course page (the /nc/course/psy-150 "Elon ×50" bug). */
export async function getTransferInfo(
  prefix: string,
  number: string,
  state: string
): Promise<TransferMapping[]> {
  // Scoped query on the idx_transfers_state_course (state, cc_prefix, cc_number)
  // index — returns the handful of rows for THIS course directly. The old code
  // called loadTransferMappings(state), which paginates the WHOLE state's
  // transfer set into memory and filters in JS; for a big state that is
  // catastrophic on a cold cache (CA = 161K rows ≈ 100s on a Vercel lambda),
  // and it was the dominant cause of the /[state]/course/* 504 timeouts.
  return cached(`transfer-course:${state}:${prefix}:${number}`, async () => {
    const scoped = () =>
      supabase
        .from("transfers")
        .select(
          "cc_prefix, cc_number, cc_course, cc_title, cc_credits, university, university_name, univ_course, univ_title, univ_credits, notes, no_credit, is_elective"
        )
        .eq("state", state)
        .eq("cc_prefix", prefix)
        .eq("cc_number", number);

    let { data, error } = await scoped();
    if (error) {
      // Retry the SCOPED query once (it hits idx_transfers_state_course and
      // returns the handful of rows for this one course). The previous fallback
      // here was loadTransferMappings(state), which paginates the WHOLE state's
      // transfer table into memory — under crawler load the scoped query times
      // out, the full-state load times out harder, and that timeout→load-all
      // cascade was the dominant driver of the egress-quota overage (41M
      // full-state reads in pg_stat_statements). Never load the whole state per
      // request; on persistent error return [] (uncached only briefly via the
      // 30-min TTL, far cheaper than re-paginating millions of rows).
      console.error("getTransferInfo error (retrying scoped):", error.message);
      ({ data, error } = await scoped());
      if (error) {
        console.error("getTransferInfo scoped retry failed:", error.message);
        return [];
      }
    }
    return collapseDuplicateMappings((data || []) as TransferMapping[]);
  });
}

/**
 * Get a short summary string for display, e.g.:
 *   "→ UNI: ENGL 1105"
 *   "→ UNI: BUS 1XXX (elective)"
 *   "✗ No UNI credit"
 *   null if no data
 */
export async function transferSummaryLine(
  prefix: string,
  number: string,
  state: string
): Promise<{ text: string; type: "direct" | "elective" | "no-credit" } | null> {
  const info = await getTransferInfo(prefix, number, state);
  if (info.length === 0) return null;

  // Use first mapping (usually one per course per university)
  const m = info[0];
  const uni = (m.university || "").toUpperCase();
  if (m.no_credit) {
    return { text: `No ${uni} credit`, type: "no-credit" };
  }
  if (m.is_elective) {
    return {
      text: `${uni}: ${m.univ_course} (elective)`,
      type: "elective",
    };
  }
  return {
    text: `${uni}: ${m.univ_course}`,
    type: "direct",
  };
}

/** Get all universities that accept a given course (excludes no-credit). */
export async function getAcceptingUniversities(
  prefix: string,
  number: string,
  state: string
): Promise<string[]> {
  const info = await getTransferInfo(prefix, number, state);
  return info.filter((m) => !m.no_credit).map((m) => m.university_name);
}

/** Get all mappings for a specific university. */
export async function getCoursesForUniversity(
  university: string,
  state: string
): Promise<TransferMapping[]> {
  // Scope the fetch to this university via the indexed (state, university)
  // query — idx_transfers_state_university — instead of loading the ENTIRE
  // state's transfers and filtering in JS. The old path pulled every CA row
  // (161,680 / ~30 MB / ~162 Supabase pages) to render a single university's
  // hub page, so even a 642-mapping university 504'd at the function timeout.
  // Same load-all-then-filter anti-pattern already fixed for getUniversities()
  // (#777), getUniversitiesWithCounts() (#1206) and the sitemap (#1207).
  return loadTransferMappingsByUniversity(state, university);
}

/** Get the list of all universities in the dataset.
 *
 * Performance: previously called loadTransferMappings(state) and pulled every
 * column of every row just to enumerate distinct universities. For TX (187k
 * mappings × 13 columns) that walked ~6 MB across ~188 Supabase pages on
 * every cold render of /tx/transfer — which combined with downstream work
 * pushed past Vercel's 30s function timeout (observed 15s+ TTFB). Now uses
 * a column-projected query (just `university, university_name`), keeping
 * the same pagination but slashing wire payload and JSON parse cost.
 */
/**
 * Per-course "available this term" map for the transfer finder, read from the
 * build-time cache data/{state}/course-availability.json (built by
 * scripts/build-course-availability-cache.ts). Keyed "PREFIX-NUMBER". Returns {}
 * when the cache is absent so the page degrades gracefully. A cheap file read
 * (~tens of KB) — this replaces the request-time course fan-out that tripped
 * Vercel's streaming timeout and forced the empty `{}` in #777.
 */
export function loadCourseAvailability(
  state: string
): Record<string, { colleges: string[]; totalSections: number }> {
  try {
    const cachePath = path.join(process.cwd(), "data", state, "course-availability.json");
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<
        string,
        { colleges: string[]; totalSections: number }
      >;
    }
  } catch {
    // fall through to empty — the page still renders, just without availability
  }
  return {};
}

export async function getUniversities(
  state: string
): Promise<{ slug: string; name: string; mappingCount?: number }[]> {
  // Fast path: pre-computed cache file from scripts/build-transfer-universities-cache.ts.
  // For CA (100K+ mappings) and TX (280K+), iterating all rows in Supabase took
  // 16-23s and pushed the page past Vercel's serverless timeout — see issue #777.
  // The cache file is ~1 KB and read in <5ms. Regenerated by `npm run build`
  // and after every transfer-equiv refresh.
  try {
    const cachePath = path.join(process.cwd(), "data", state, "transfer-universities.json");
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
        slug: string;
        name: string;
        mappingCount?: number;
      }[];
      if (Array.isArray(cached) && cached.length > 0) return cached;
    }
  } catch {
    // Cache read failed — fall through to Supabase
  }

  // No precomputed cache → return empty rather than scanning the whole state's
  // transfer table at request time. The old fallbacks here (a paginated
  // `SELECT university,university_name WHERE state=$1` loop, then
  // `loadTransferMappings(state)` which pulls ALL 13 columns for the state)
  // were both full-state loads — under crawler load they were a top egress
  // driver (millions of `transfers WHERE state` calls in pg_stat_statements).
  // The cache file is the source of truth (regenerated by `npm run build` via
  // scripts/build-transfer-universities-cache.ts and after every transfer
  // refresh); a state with no cache simply has no university list yet.
  return [];
}

/**
 * Get all universities with per-university mapping counts, excluding
 * combo-credit rows (univ_course containing "*") and counting direct,
 * elective, and no-credit separately.
 *
 * Used by the /[state]/transfer "Browse by university" list and by the
 * transfer-hub page's thin-content guard in generateStaticParams.
 */
export async function getUniversitiesWithCounts(state: string): Promise<
  {
    slug: string;
    name: string;
    directCount: number;
    electiveCount: number;
    totalCount: number; // direct + elective (i.e. "transferable" count)
  }[]
> {
  // Memoize per state — this function is the heaviest read in the codebase
  // (paginates the full transfers table for the state) and gets called 3×
  // per transfer-hub page during static prerender: once in
  // generateStaticParams, once in generateMetadata, once in the page handler.
  // Without dedup, a build that renders ~100 transfer-hub pages fires 300+
  // identical paginations and reliably hits Supabase's statement_timeout.
  // The cache lives in-process so it survives the whole build cycle for a
  // given Vercel worker.
  return cached(`universities-with-counts:${state}`, () =>
    _getUniversitiesWithCounts(state),
  );
}

async function _getUniversitiesWithCounts(state: string): Promise<
  {
    slug: string;
    name: string;
    directCount: number;
    electiveCount: number;
    totalCount: number;
  }[]
> {
  // Fast path: pre-computed cache file from build-transfer-universities-cache.ts
  // (wired into `npm run build`). getUniversities() got this #777 fix; this
  // counts variant was missed and kept paginating the full transfers table —
  // 162K rows for CA, ~10s to cold-render /[state]/transfer. The cache is
  // ~1 KB and read in <5ms. The totalCount type-guard means an older cache
  // file written before this field existed falls through to Supabase, so the
  // change is safe before the cache is regenerated.
  try {
    const cachePath = path.join(
      process.cwd(),
      "data",
      state,
      "transfer-universities.json",
    );
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
        slug: string;
        name: string;
        directCount?: number;
        electiveCount?: number;
        totalCount?: number;
      }[];
      if (
        Array.isArray(cached) &&
        cached.length > 0 &&
        typeof cached[0].totalCount === "number"
      ) {
        return cached
          .map((c) => ({
            slug: c.slug,
            name: c.name,
            directCount: c.directCount ?? 0,
            electiveCount: c.electiveCount ?? 0,
            totalCount: c.totalCount ?? 0,
          }))
          .sort((a, b) => b.totalCount - a.totalCount);
      }
    }
  } catch {
    // Cache read/parse failed — fall through to Supabase.
  }

  // Performance: column-projected Supabase query — same reason as
  // getUniversities. Only pulls the 5 fields we actually inspect, not the
  // full 13. See that function's comment.
  const map = new Map<
    string,
    { name: string; directCount: number; electiveCount: number }
  >();

  let usedSupabase = false;
  try {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("transfers")
        .select(
          "university, university_name, univ_course, no_credit, is_elective"
        )
        .eq("state", state)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;
      for (const row of data) {
        if (row.univ_course && row.univ_course.includes("*")) continue;
        if (row.no_credit) continue;
        if (!map.has(row.university)) {
          map.set(row.university, {
            name: row.university_name,
            directCount: 0,
            electiveCount: 0,
          });
        }
        const entry = map.get(row.university)!;
        if (row.is_elective) entry.electiveCount++;
        else entry.directCount++;
      }
      usedSupabase = true;
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  } catch {
    // Supabase unavailable — fall through to local JSON
  }

  // Fallback: local JSON (Supabase returned nothing usable)
  if (!usedSupabase || map.size === 0) {
    const mappings = await loadTransferMappings(state);
    for (const m of mappings) {
      if (m.univ_course && m.univ_course.includes("*")) continue;
      if (m.no_credit) continue;
      if (!map.has(m.university)) {
        map.set(m.university, {
          name: m.university_name,
          directCount: 0,
          electiveCount: 0,
        });
      }
      const entry = map.get(m.university)!;
      if (m.is_elective) entry.electiveCount++;
      else entry.directCount++;
    }
  }

  return Array.from(map.entries())
    .map(([slug, v]) => ({
      slug,
      name: v.name,
      directCount: v.directCount,
      electiveCount: v.electiveCount,
      totalCount: v.directCount + v.electiveCount,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
}

/**
 * Lightweight version for the sitemap: returns only { slug, totalCount } per
 * university without loading every row. Fetches only the `university` column
 * with pagination, then aggregates in memory.
 */
export async function getUniversitySlugsForSitemap(
  state: string
): Promise<{ slug: string; totalCount: number }[]> {
  // Fast path: pre-computed cache file from build-transfer-universities-cache.ts
  // (wired into `npm run build`). Its `totalCount` is the filtered transferable
  // count — no_credit and wildcard ('*') rows excluded — identical to both the
  // Supabase query below and getUniversitiesWithCounts(). Reading the ~1 KB
  // cache avoids paginating the entire transfers table (161K rows for CA, 254K
  // for NY) during sitemap generation, the same #777 fix getUniversities() and
  // getUniversitiesWithCounts() (PR #1206) already got. The totalCount
  // type-guard falls through to Supabase for any cache written before #1206.
  try {
    const cachePath = path.join(
      process.cwd(),
      "data",
      state,
      "transfer-universities.json",
    );
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
        slug: string;
        totalCount?: number;
      }[];
      if (
        Array.isArray(cached) &&
        cached.length > 0 &&
        typeof cached[0].totalCount === "number"
      ) {
        return cached
          .map((c) => ({ slug: c.slug, totalCount: c.totalCount ?? 0 }))
          .sort((a, b) => b.totalCount - a.totalCount);
      }
    }
  } catch {
    // Cache read/parse failed — fall through to Supabase.
  }

  try {
    const counts = new Map<string, number>();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("transfers")
        .select("university")
        .eq("state", state)
        .eq("no_credit", false)
        .not("univ_course", "like", "%*%")
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;
      for (const row of data) {
        counts.set(row.university, (counts.get(row.university) || 0) + 1);
      }
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (counts.size > 0) {
      return Array.from(counts.entries())
        .map(([slug, totalCount]) => ({ slug, totalCount }))
        .sort((a, b) => b.totalCount - a.totalCount);
    }
  } catch {
    // fall through to local file
  }

  try {
    const raw = fs.readFileSync(dataPath(state), "utf-8");
    const mappings = JSON.parse(raw) as TransferMapping[];
    const counts = new Map<string, number>();
    for (const m of mappings) {
      if (m.univ_course && m.univ_course.includes("*")) continue;
      if (m.no_credit) continue;
      counts.set(m.university, (counts.get(m.university) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([slug, totalCount]) => ({ slug, totalCount }))
      .sort((a, b) => b.totalCount - a.totalCount);
  } catch {
    return [];
  }
}

// Re-export the lookup shape from the edge-safe module so callers that need
// the type can import it from either module. The scoped helpers themselves
// live in `lib/transfer-scoped.ts` to keep `fs`/`path` out of edge bundles.
export type { TransferLookup } from "./transfer-scoped";
import type { TransferLookup } from "./transfer-scoped";

/**
 * Build a lookup map for client-side filtering:
 * { "ENG-111": [{ university: "vt", type: "direct" }], ... }
 */
export async function buildTransferLookup(state: string): Promise<TransferLookup> {
  const mappings = await loadTransferMappings(state);
  const lookup: TransferLookup = {};

  for (const m of mappings) {
    // Skip combo-credit entries (e.g. ODU's "**** ****") — they only
    // transfer when paired with other courses, not standalone.
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
