// Pure, dependency-free term helpers safe for client bundles.
// Keep this module free of `fs`, Supabase, or any Node-only imports so that
// client components can import `termLabel` without dragging server code into
// the browser bundle.

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
 * Inverse of termLabel: convert a human label like "Fall 2026" or
 * "Summer 2026" into the term code ("2026FA", "2026SU"). Returns null
 * if the input doesn't match the expected shape — callers should fall
 * back to the default (current) term in that case rather than guess.
 *
 * Used to translate LLM-extracted term strings (which come out as
 * labels per the classifier prompt) into backend-compatible codes.
 */
export function termCodeFromLabel(label: string): string | null {
  const m = label.trim().match(/^(spring|summer|fall)\s+(\d{4})$/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  const code = season === "spring" ? "SP" : season === "summer" ? "SU" : "FA";
  return `${year}${code}`;
}

/**
 * Sort key for term codes — later terms sort higher.
 * "2026SP" → 20261, "2026SU" → 20262, "2026FA" → 20263
 */
export function termSortKey(code: string): number {
  const match = code.match(/^(\d{4})(SP|SU|FA)$/);
  if (!match) return 0;
  const year = parseInt(match[1]);
  const season = match[2] === "SP" ? 1 : match[2] === "SU" ? 2 : 3;
  return year * 10 + season;
}
