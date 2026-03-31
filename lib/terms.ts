import { getAvailableTerms } from "./courses";

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
export function getAvailableTermsForDisplay(): {
  code: string;
  label: string;
}[] {
  const terms = getAvailableTerms();
  return terms
    .map((code) => ({ code, label: termLabel(code) }))
    .sort((a, b) => termSortKey(b.code) - termSortKey(a.code));
}

/**
 * Get the current (latest) term code by scanning the data directory.
 * Returns the most recent term that has data, e.g. "2026SU" if Summer data exists.
 * Falls back to "2026SP" if no data is found.
 */
export function getCurrentTerm(): string {
  const terms = getAvailableTerms();
  if (terms.length === 0) return "2026SP";
  // Sort by term key and return the latest
  return terms.sort((a, b) => termSortKey(b) - termSortKey(a))[0];
}

/**
 * Get the next term after the latest one we have data for.
 * SP → SU → FA → next year SP
 */
export function getNextTerm(): { code: string; label: string } {
  const current = getCurrentTerm();
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
