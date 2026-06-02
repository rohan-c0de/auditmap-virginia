import type { TransferMapping } from "@/lib/types";

export type SortMode = "weighted" | "acceptance" | "direct" | "alphabetical";
export type OutcomeFilter = "all" | "direct-only" | "transferable" | "hide-no-credit";
export type CellStatus = "direct" | "elective" | "no-credit" | "unknown";

export interface CompareFilters {
  sortMode: SortMode;
  outcomeFilter: OutcomeFilter;
  availableOnly: boolean;
}

export interface CCCourse {
  prefix: string;
  number: string;
  course: string;
  title: string;
}

export interface UniversityScore {
  slug: string;
  name: string;
  direct: number;
  elective: number;
  noCredit: number;
  unknown: number;
  availableBonus: number;
  transferable: number;
  total: number;
  pct: number;
  weightedScore: number;
  maxWeightedScore: number;
  isBestFit: boolean;
}

export interface CellInfo {
  status: CellStatus;
  label: string;
  course: string;
  title: string;
  credits: string;
  notes: string;
}

export const CELL_COLORS: Record<CellStatus, string> = {
  direct: "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400",
  elective: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
  "no-credit": "bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400",
  unknown: "bg-gray-50 dark:bg-slate-800 text-gray-300 dark:text-slate-600",
};

export function getCellInfo(
  course: CCCourse,
  uniSlug: string,
  transferLookup: Map<string, TransferMapping>
): CellInfo {
  const m = transferLookup.get(`${course.course}|${uniSlug}`);
  if (!m)
    return { status: "unknown", label: "\u2014", course: "", title: "", credits: "", notes: "" };
  if (m.no_credit)
    return { status: "no-credit", label: "\u2717", course: "", title: "Does not transfer", credits: "", notes: m.notes || "" };
  if (m.is_elective)
    return { status: "elective", label: "~", course: m.univ_course, title: m.univ_title, credits: m.univ_credits, notes: m.notes || "" };
  return { status: "direct", label: "\u2713", course: m.univ_course, title: m.univ_title, credits: m.univ_credits, notes: m.notes || "" };
}

// Higher is better: direct (3) > elective (2) > no-credit (1).
export function rankMapping(m: TransferMapping): number {
  return m.no_credit ? 1 : m.is_elective ? 2 : 3;
}

/**
 * Collapse one-to-many transfer mappings to the BEST outcome per (course, university).
 *
 * A single CC course can map to several university courses with different statuses
 * (one row direct, another elective, another no-credit). The comparison cell must
 * reflect the best a student can actually get \u2014 direct > elective > no-credit \u2014 NOT
 * whichever row happened to be last in the array. A naive `map.set(key, m)` is last-wins
 * and silently downgrades cells (e.g. shows "does not transfer" when a direct equivalent
 * exists), which is exactly the kind of wrong transfer signal that can cost a student a
 * semester. Ties keep the first matching row, so the result is deterministic.
 */
export function buildBestMappingLookup(
  mappings: TransferMapping[]
): Map<string, TransferMapping> {
  const map = new Map<string, TransferMapping>();
  for (const m of mappings) {
    const key = `${m.cc_prefix} ${m.cc_number}|${m.university}`;
    const existing = map.get(key);
    if (!existing || rankMapping(m) > rankMapping(existing)) map.set(key, m);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Compare-matrix preload sizing
// ---------------------------------------------------------------------------

/**
 * Total transfer rows across all of a state's universities above which
 * auto-preloading the whole Compare matrix would be too heavy for the client.
 *
 * The matrix needs every university's mappings to fill its columns, but for
 * the largest states that's 150K-250K rows / tens of MB (CA, TX, NY, MI) —
 * the same payload issue #777 deliberately keeps off the initial page load.
 * Below this threshold the client preloads all universities on entering
 * Compare (most states, instant matrix); above it, the matrix loads the
 * default university only and gates the rest behind an explicit "Load all"
 * button, so a first-gen student on a low-end phone isn't forced to pull a
 * quarter-million rows just to open the tab.
 *
 * 50K cleanly separates the heavy states (≥139K) from the rest (≤26K).
 */
export const HEAVY_PRELOAD_THRESHOLD = 50_000;

/**
 * True when a state's universities collectively carry enough transfer rows
 * that the Compare matrix should NOT auto-preload them all. Universities
 * missing a `mappingCount` (e.g. the Supabase fallback path that doesn't
 * compute counts) contribute 0 — i.e. an unknown-size state defaults to the
 * cheaper auto-preload, which is safe because every heavy state ships a
 * committed cache file with real counts.
 */
export function isHeavyTransferState(
  universities: { mappingCount?: number }[]
): boolean {
  const total = universities.reduce((sum, u) => sum + (u.mappingCount ?? 0), 0);
  return total > HEAVY_PRELOAD_THRESHOLD;
}
