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
export async function getAvailableTermsForDisplay(state = "va"): Promise<{
  code: string;
  label: string;
}[]> {
  const terms = await getAvailableTerms(state);
  return terms
    .map((code) => ({ code, label: termLabel(code) }))
    .sort((a, b) => termSortKey(b.code) - termSortKey(a.code));
}

/**
 * Get the current term code by querying Supabase.
 * Uses a single RPC call to get term→college counts instead of N separate queries.
 * Returns the term with the most college data, breaking ties by recency.
 * Falls back to "2026SP" if no data is found.
 */
export async function getCurrentTerm(state = "va"): Promise<string> {
  return cached(`currentTerm:${state}`, async () => {
    // Try RPC first (single query instead of N+1)
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "get_term_college_counts",
      { p_state: state }
    );

    if (!rpcErr && rpcData && rpcData.length > 0) {
      let bestTerm = rpcData[0].term;
      let bestCount = Number(rpcData[0].college_count);

      for (const row of rpcData) {
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

    // Fallback: use getAvailableTerms + individual queries (old slow path)
    console.warn("get_term_college_counts RPC not available, using fallback");
    const terms = await getAvailableTerms(state);
    if (terms.length === 0) return "2026SP";

    let bestTerm = terms[0];
    let bestCount = 0;

    for (const term of terms) {
      const { count, error: countErr } = await supabase
        .from("courses")
        .select("id", { count: "exact", head: true })
        .eq("state", state)
        .eq("term", term);

      if (countErr) {
        console.error(`Term count error for ${term}:`, countErr.message);
        continue;
      }
      const c = count || 0;
      if (
        c > bestCount ||
        (c === bestCount && termSortKey(term) > termSortKey(bestTerm))
      ) {
        bestTerm = term;
        bestCount = c;
      }
    }

    return bestTerm;
  });
}

/**
 * Get the next term after the latest one we have data for.
 * SP → SU → FA → next year SP
 */
export async function getNextTerm(state = "va"): Promise<{ code: string; label: string }> {
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
