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

/** Lowercase, dash-collapse, trim — the shared slugify used for program URLs. */
export function slugifyText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical, unique-within-college slug for a program: title + credential. */
export function programSlug(p: { title: string; credential: string }): string {
  return slugifyText(`${p.title} ${p.credential}`);
}

/**
 * The *stable core* of a program slug: the program name with its trailing
 * degree-type clause removed. CourseLeaf/Acalog titles encode the credential
 * after an em/en-dash (e.g. "Accounting — Associate in Science"); re-scrapes
 * sometimes re-parse that clause ("…— Certificate of Completion" → "…— AS"),
 * which silently changes `programSlug` and 404s every previously-indexed URL.
 * The part *before* the dash is stable across those re-parses, so we use it to
 * recognize a legacy URL and redirect it to the current canonical slug.
 */
export function programCoreSlug(p: { title: string }): string {
  const namePart = (p.title ?? "").split(/[—–]/)[0];
  return slugifyText(namePart);
}

/**
 * Resolve a (possibly legacy) program slug to a program. Exact `programSlug`
 * match wins. Otherwise we look for the single program whose stable core slug
 * is the longest unique prefix of the requested slug — that's a program whose
 * title was reformatted since the URL was minted. Ambiguous matches (two
 * programs sharing the same core) return null rather than guessing.
 *
 * Returns the matched program plus `isLegacy` (true when the requested slug is
 * not already canonical, signaling the caller should 301/308-redirect).
 */
export function resolveProgramBySlug<T extends { title: string; credential: string }>(
  programs: T[],
  slug: string,
): { program: T; canonicalSlug: string; isLegacy: boolean } | null {
  const exact = programs.find((p) => programSlug(p) === slug);
  if (exact) return { program: exact, canonicalSlug: slug, isLegacy: false };

  let best: T | null = null;
  let bestLen = -1;
  let tie = false;
  for (const p of programs) {
    const core = programCoreSlug(p);
    if (!core) continue;
    if (slug === core || slug.startsWith(core + "-")) {
      if (core.length > bestLen) {
        best = p;
        bestLen = core.length;
        tie = false;
      } else if (core.length === bestLen) {
        tie = true;
      }
    }
  }
  if (best && !tie) {
    return { program: best, canonicalSlug: programSlug(best), isLegacy: true };
  }
  return null;
}
