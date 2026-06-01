import { getAvailableTerms } from "./courses";
import { supabase } from "./supabase";
import { termLabel, termSortKey } from "./term-label";

// Re-export pure helpers so existing `@/lib/terms` imports keep working.
// New client-only callers should import directly from `@/lib/term-label` to
// avoid pulling Supabase + fs into the client bundle.
export { termLabel, termSortKey };

// ---------------------------------------------------------------------------
// In-memory cache (shared with courses.ts pattern)
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
 * Get all available terms with labels, sorted newest first.
 */
export async function getAvailableTermsForDisplay(state: string): Promise<{
  code: string;
  label: string;
}[]> {
  const terms = await getAvailableTerms(state);
  return terms
    .map((code) => ({ code, label: termLabel(code) }))
    .sort((a, b) => termSortKey(b.code) - termSortKey(a.code));
}

// ---------------------------------------------------------------------------
// Batch current-term resolver
//
// During Next.js static generation, dozens of pages call getCurrentTerm() for
// different states concurrently. The old per-state RPC accumulated enough
// connection pressure to time out the 2-minute Supabase statement_timeout once
// the courses table passed ~1M rows. This version fetches ALL states' term
// counts in a single RPC (get_all_term_college_counts, ~400ms) and caches the
// result map so every subsequent getCurrentTerm(state) is a synchronous lookup.
// ---------------------------------------------------------------------------

interface TermCountRow {
  state: string;
  term: string;
  college_count: number;
}

function pickBestTerm(rows: TermCountRow[]): string {
  if (rows.length === 0) return "2026SP";
  let bestTerm = rows[0].term;
  let bestCount = Number(rows[0].college_count);
  for (const row of rows) {
    const count = Number(row.college_count);
    if (
      count > bestCount ||
      (count === bestCount && termSortKey(row.term) > termSortKey(bestTerm))
    ) {
      bestTerm = row.term;
      bestCount = count;
    }
  }
  return bestTerm;
}

async function loadAllCurrentTerms(): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("get_all_term_college_counts");

  if (error || !data) {
    console.warn("get_all_term_college_counts RPC error:", error?.message ?? error);
    return new Map();
  }

  const byState = new Map<string, TermCountRow[]>();
  for (const row of data as TermCountRow[]) {
    if (!byState.has(row.state)) byState.set(row.state, []);
    byState.get(row.state)!.push(row);
  }

  const result = new Map<string, string>();
  for (const [st, rows] of byState) {
    result.set(st, pickBestTerm(rows));
  }
  return result;
}

/**
 * Get the current term code by querying Supabase.
 * Batch-fetches all states' term→college counts in one RPC call, then caches
 * the map. Returns the term with the most college data, breaking ties by recency.
 * Falls back to "2026SP" if no data is found.
 */
export async function getCurrentTerm(state: string): Promise<string> {
  return cached(`currentTerm:${state}`, async () => {
    const allTerms = await cached("currentTermMap:all", loadAllCurrentTerms);
    return allTerms.get(state) ?? "2026SP";
  });
}

/**
 * Get the next term after the latest one we have data for.
 * SP → SU → FA → next year SP
 */
export async function getNextTerm(state: string): Promise<{ code: string; label: string }> {
  const current = await getCurrentTerm(state);
  const match = current.match(/^(\d{4})(SP|SU|FA)$/);
  if (!match) return { code: "2026FA", label: "Fall 2026" };

  const year = parseInt(match[1]);
  const season = match[2];

  let nextCode: string;
  if (season === "SP") nextCode = `${year}SU`;
  else if (season === "SU") nextCode = `${year}FA`;
  else nextCode = `${year + 1}SP`;

  return { code: nextCode, label: termLabel(nextCode) };
}
