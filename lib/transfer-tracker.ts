/**
 * Pure helpers for the transfer-progress tracker (Milestone C). A "transfer
 * goal" = a saved plan + a target university + the courses the user has marked
 * completed. Split from the UI so they're unit-testable without a DOM (the
 * vitest env is "node"). Dependency-free apart from a type-only TransferMapping
 * import + the (also dependency-free) transfer-rank ranker, so this stays safe
 * to import from client components.
 */
import type { TransferMapping } from "@/lib/types";
import { rankMapping } from "@/lib/transfer-rank";

export type TransferVerdict = "direct" | "elective" | "no-credit" | "none";

export interface ProgressSummary {
  direct: number;
  elective: number;
  noCredit: number;
  noData: number;
}

/**
 * Toggle a course code in/out of the completed set: remove it if present, add
 * it (deduped) if absent. Returns a new array.
 */
export function toggleCompleted(completed: string[], code: string): string[] {
  if (completed.includes(code)) return completed.filter((c) => c !== code);
  return Array.from(new Set([...completed, code]));
}

/** How many of the plan's target courses are marked completed (set-based, so
 *  stray duplicates or extra completed codes never inflate the count). */
export function completedCount(
  targetCourses: string[],
  completed: string[],
): { done: number; total: number } {
  const set = new Set(completed);
  const done = targetCourses.filter((c) => set.has(c)).length;
  return { done, total: targetCourses.length };
}

/**
 * Best transfer outcome for a single course code against ONE university's
 * mappings (direct > elective > no-credit; "none" if unmapped). `mappings`
 * must already be filtered to one university (loadTransferMappingsByUniversity).
 * Uses transfer-rank's rankMapping so the one-to-many collapse always surfaces
 * the best outcome — never first/last-wins. Matches the code by prefix+number.
 */
export function transferVerdict(
  mappings: TransferMapping[],
  code: string,
): TransferVerdict {
  let best = 0; // rankMapping: no_credit→1, is_elective→2, else direct→3
  for (const m of mappings) {
    if (`${m.cc_prefix} ${m.cc_number}` !== code) continue;
    const r = rankMapping(m);
    if (r > best) best = r;
  }
  return best === 3 ? "direct" : best === 2 ? "elective" : best === 1 ? "no-credit" : "none";
}

/**
 * Tally how the COMPLETED courses transfer, using a per-course verdict map.
 * "noData" (no published mapping) is its own bucket — never counted as a fail,
 * so it can be excluded from any percentage (the fair-denominator rule).
 */
export function progressSummary(
  completed: string[],
  verdicts: Record<string, TransferVerdict>,
): ProgressSummary {
  const out: ProgressSummary = { direct: 0, elective: 0, noCredit: 0, noData: 0 };
  for (const code of completed) {
    const v = verdicts[code] ?? "none";
    if (v === "direct") out.direct++;
    else if (v === "elective") out.elective++;
    else if (v === "no-credit") out.noCredit++;
    else out.noData++;
  }
  return out;
}
