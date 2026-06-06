/**
 * Deep-link helper for the semester planner.
 *
 * The planner (app/[state]/plan/PlannerClient.tsx) reads ?targets= from the
 * URL — a comma-separated list of "PREFIX NUMBER" course codes (e.g.
 * "ACCT 2301,ACCT 2302") — and seeds them as plan targets. This builds that
 * link so course-search results and program requirement lists can hand a
 * student's selected course(s) straight into the planner instead of making
 * them re-type codes by hand.
 *
 * Codes are trimmed, de-duplicated, and capped at 100 to mirror the planner's
 * own slice(0, 100) and keep the URL bounded. Each code is percent-encoded and
 * the codes are joined with literal commas, matching the planner's split(",").
 * Returns "" for an empty list so a caller can skip rendering the affordance.
 */
export function plannerHref(state: string, codes: string[]): string {
  const unique = Array.from(
    new Set(codes.map((c) => c.trim()).filter(Boolean)),
  ).slice(0, 100);
  if (unique.length === 0) return "";
  const param = unique.map(encodeURIComponent).join(",");
  return `/${state}/plan?targets=${param}`;
}
