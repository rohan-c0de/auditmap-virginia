import { getAvailableTerms } from "./courses";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// In-memory cache (shared with courses.ts pattern)
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expires > Date.now()) return entry.data;
  const data = await fn();
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

/**
 * Convert a term code like "2026SU" into a human-readable label like "Summer 2026".
 */
export function termLabel(code: string): string {
  const match = code.match(/^(\d{4})(SP|SU|FA)$/);
  if (!match) return code;
  const year = match[1];
  const season = match[2];
  const seasonName =
    season === "SP" ? "Spring" : season === "SU" ? "Summer" : "Fall";
  return `${seasonName} ${year}`;
}

/**
 * Sort key for term codes — later terms sort higher.
 * "2026SP" → 20261, "2026SU" → 20262, "2026FA" → 20263
 */
function termSortKey(code: string): number {
  const match = code.match(/^(\d{4})(SP|SU|FA)$/);
  if (!match) return 0;
  const year = parseInt(match[1]);
  const season = match[2] === "SP" ? 1 : match[2] === "SU" ? 2 : 3;
  return year * 10 + season;
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
      const { count } = await supabase
        .from("courses")
        .select("id", { count: "exact", head: true })
        .eq("state", state)
        .eq("term", term);

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
