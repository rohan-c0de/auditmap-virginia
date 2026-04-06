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
