/**
 * Pure helpers shared between the server-side planner (lib/programs/planner.ts)
 * and client components (e.g. the program list). NO server-only imports (fs,
 * supabase) — safe to pull into a client bundle.
 */

import type { RequirementGroup } from "@/lib/types";

/** A program needs this many real courses before a plan is worth rendering. */
export const PLAN_MIN_COURSES = 5;

/** A "real" course has a digit in its number and is not an XXX placeholder. */
export function isRealCourse(c: { prefix: string; number: string }): boolean {
  const num = String(c.number ?? "");
  const pre = String(c.prefix ?? "");
  if (pre.toUpperCase().includes("XXX") || num.toUpperCase().includes("XXX")) {
    return false;
  }
  return /\d/.test(num);
}

/** Count the real (non-placeholder) courses listed in a program's groups. */
export function countRealCourses(p: { requirement_groups: RequirementGroup[] }): number {
  return p.requirement_groups.flatMap((g) => g.courses).filter(isRealCourse).length;
}

/** Stable, unique-within-college slug for a program: title + credential. */
export function programSlug(p: { title: string; credential: string }): string {
  return `${p.title} ${p.credential}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
