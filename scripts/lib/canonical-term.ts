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

// ---------------------------------------------------------------------------
// Import-unit planning
// ---------------------------------------------------------------------------

export interface RawTermFile {
  /** Filename without ".json" — the term as the scraper wrote it. */
  stem: string;
  sections: TermSection[];
}

export interface ImportUnit {
  /** The term the rows should be stored under in Supabase. */
  term: string;
  sections: TermSection[];
  /** True when `term` was rewritten from a non-canonical stem. */
  canonicalized: boolean;
}

/**
 * Decide what (term, rows) units a single college's course files should import
 * as. This is the one place that turns "files on disk" into "rows keyed by
 * term", so the importer's delete-then-insert can't clobber across files.
 *
 * Safety invariant: if the college has ANY canonical (`YYYYSP|SU|FA`) term
 * file, behaviour is IDENTICAL to the legacy per-file path — one unit per file,
 * term = filename stem, no grouping, no row rewriting. This means every college
 * that already works (incl. ones with a canonical primary term plus extra
 * winter / summer-sub-session files, e.g. WA's 2027WI) is completely
 * unaffected.
 *
 * Only FULLY-INVISIBLE colleges — zero canonical term files, so their entire
 * catalog is hidden from search — get canonicalized: each file's term is
 * resolved from its rows' start_dates, files resolving to the same canonical
 * term are merged (CRN-deduped) into one unit, and files that can't be resolved
 * confidently keep their raw stem (never guessed, never lost).
 */
export function buildImportUnits(files: RawTermFile[]): ImportUnit[] {
  const hasCanonical = files.some((f) => CANONICAL_TERM.test(f.stem));
  if (hasCanonical) {
    // Legacy behaviour, byte-for-byte: one unit per file, no rewriting.
    return files.map((f) => ({
      term: f.stem,
      sections: f.sections,
      canonicalized: false,
    }));
  }

  // Fully-invisible college: resolve + group by canonical term.
  const groups = new Map<string, Map<string, TermSection>>();
  const order: string[] = [];
  for (const f of files) {
    const term = resolveCanonicalTerm(f.stem, f.sections) ?? f.stem;
    let bucket = groups.get(term);
    if (!bucket) {
      bucket = new Map();
      groups.set(term, bucket);
      order.push(term);
    }
    f.sections.forEach((s, i) => {
      const crn = (s as { crn?: unknown }).crn;
      // CRN dedups across merged files; rows without a CRN are never collapsed.
      const key = crn != null && String(crn).trim() ? String(crn) : `${f.stem}#${i}`;
      bucket!.set(key, s);
    });
  }
  return order.map((term) => ({
    term,
    sections: [...groups.get(term)!.values()],
    canonicalized: CANONICAL_TERM.test(term),
  }));
}
