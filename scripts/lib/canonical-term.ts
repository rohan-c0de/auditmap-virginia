/**
 * Canonical-term resolution.
 *
 * The course importer keys Supabase rows by a term code derived from the
 * course filename (data/{state}/courses/{college}/{TERM}.json). Course search
 * and getCurrentTerm() only understand the canonical shape `YYYY` + `SP|SU|FA`.
 * Many scrapers, however, wrote idiosyncratic term filenames — `FL26`,
 * `2026FL`, `26-FAL`, `F26-27`, `2026-02`, `226FA`, `UG26FA`, `Q32026`, ... —
 * so those colleges' courses imported under terms search never queries and
 * were invisible on prod (36 colleges across 13 states as of 2026-06-01).
 *
 * Parsing those filename codes is unreliable (e.g. delta-college's `26-SP`
 * file actually holds summer-start sections). The robust signal is the row
 * `start_date`s themselves: derive the term from the modal (year, season) of
 * the actual class start dates.
 */

export const CANONICAL_TERM = /^(\d{4})(SP|SU|FA)$/;

export interface TermSection {
  start_date?: string | null;
  [k: string]: unknown;
}

/** Month -> season. FA: Aug-Dec, SP: Jan-Apr, SU: May-Jul. */
function seasonForMonth(month: number): "SP" | "SU" | "FA" {
  if (month >= 8) return "FA";
  if (month <= 4) return "SP";
  return "SU";
}

/**
 * Infer the canonical term from the modal (year, season) across a file's row
 * start_dates. Returns the winning term, the share of dated rows that agree
 * (confidence), and how many rows carried a usable date.
 */
export function inferTermFromStartDates(rows: TermSection[]): {
  term: string | null;
  confidence: number;
  dated: number;
} {
  const buckets = new Map<string, number>();
  let dated = 0;
  for (const r of rows) {
    const d = r.start_date;
    if (!d || typeof d !== "string") continue;
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    const key = `${year}${seasonForMonth(month)}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    dated++;
  }
  if (dated === 0) return { term: null, confidence: 0, dated: 0 };
  let bestTerm = "";
  let bestCount = 0;
  for (const [term, count] of buckets) {
    if (count > bestCount) {
      bestTerm = term;
      bestCount = count;
    }
  }
  return { term: bestTerm, confidence: bestCount / dated, dated };
}

/**
 * Resolve the canonical term for a course file.
 *  - If the filename stem is already canonical (`2026FA`), trust it.
 *  - Otherwise infer from start_dates, but only accept the inference when it's
 *    confident enough (default 60% of dated rows agree). Below that, or with no
 *    usable dates, return null so the caller can leave the file alone rather
 *    than guess.
 */
export function resolveCanonicalTerm(
  stem: string,
  rows: TermSection[],
  minConfidence = 0.6,
): string | null {
  if (CANONICAL_TERM.test(stem)) return stem;
  const inf = inferTermFromStartDates(rows);
  if (inf.term && inf.confidence >= minConfidence) return inf.term;
  return null;
}
