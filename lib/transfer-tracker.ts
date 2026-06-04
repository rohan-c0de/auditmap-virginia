/**
 * Pure helpers for the transfer-progress tracker (Milestone C). A "transfer
 * goal" = a saved plan + a target university + the courses the user has marked
 * completed. Split from the UI so they're unit-testable without a DOM (the
 * vitest env is "node").
 */

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
