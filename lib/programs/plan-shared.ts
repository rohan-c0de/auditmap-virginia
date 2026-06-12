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

// ── honors-variant folding ──────────────────────────────────────────────────

/** If `title` is an honors variant ("Honors X", "X (Honors)", "X - Honors"),
 *  return the base title X (normalized); otherwise null. */
function honorsBaseTitle(title: string): string | null {
  const t = (title ?? "").trim();
  const prefix = t.match(/^honors\s+(.+)$/i);
  if (prefix) return normTitle(prefix[1]);
  const suffix = t.match(/^(.+?)\s*(?:\(\s*honors\s*\)|[-–—]\s*honors)$/i);
  if (suffix) return normTitle(suffix[1]);
  return null;
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Collapse honors variants into their base course's `or_alternatives`.
 *
 * Some catalogs (e.g. Tri-C/OH) list "ENG 1010 College Composition I" and
 * "ENG 101H Honors College Composition I" as two separate rows in the same
 * requirement group when the real requirement is "take either". Rendering
 * both as required overstates the degree — the exact mistake a first-gen
 * student can't catch. Fold rule (deliberately narrow): same prefix, and one
 * title is exactly the honors-marked form of the other.
 *
 * Pure + non-mutating: returns new course objects; safe for client bundles.
 */
export function foldHonorsVariants<
  T extends {
    prefix: string;
    number: string;
    title: string;
    credits: number | null;
    or_alternatives: Array<{ prefix: string; number: string; title: string }>;
  },
>(courses: T[]): T[] {
  const folded = new Set<number>();
  const out: T[] = [];

  for (let i = 0; i < courses.length; i++) {
    if (folded.has(i)) continue;
    const base = courses[i];
    if (honorsBaseTitle(base.title) !== null) {
      // This row is itself an honors variant: fold it only if its base course
      // exists somewhere in the group (handled when we reach the base);
      // otherwise keep it as-is.
      const hasBase = courses.some(
        (c, j) =>
          j !== i &&
          !folded.has(j) &&
          c.prefix === base.prefix &&
          normTitle(c.title) === honorsBaseTitle(base.title),
      );
      if (hasBase) continue; // will be absorbed by its base course below
      out.push(base);
      continue;
    }

    const variants: T[] = [];
    let credits = base.credits;
    for (let j = 0; j < courses.length; j++) {
      if (j === i || folded.has(j)) continue;
      const cand = courses[j];
      if (
        cand.prefix === base.prefix &&
        honorsBaseTitle(cand.title) === normTitle(base.title)
      ) {
        variants.push(cand);
        folded.add(j);
        // Recover credits the scraper lost on one of the pair.
        if ((credits == null || credits === 0) && (cand.credits ?? 0) > 0) {
          credits = cand.credits;
        }
      }
    }

    if (variants.length === 0) {
      out.push(base);
    } else {
      out.push({
        ...base,
        credits,
        or_alternatives: [
          ...base.or_alternatives,
          ...variants.map((v) => ({
            prefix: v.prefix,
            number: v.number,
            title: v.title,
          })),
        ],
      });
    }
  }

  return out;
}
