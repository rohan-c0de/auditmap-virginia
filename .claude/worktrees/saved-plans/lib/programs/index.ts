/**
 * Program-page data layer. Aggregates per-college sections for a program
 * (from the registry) in a given state and current term. Threshold-gated:
 * a program qualifies for its own page only if PROGRAM_MIN_COLLEGES colleges
 * each offer at least PROGRAM_MIN_SECTIONS sections in the program prefixes.
 *
 * Keep thresholds tight to avoid thin-content pSEO. Same discipline as
 * sitemap.ts (≥3, ≥5, ≥10 thresholds elsewhere).
 */

import { loadCoursesBySubject } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import { loadInstitutions } from "@/lib/institutions";
import { PROGRAMS, getProgramBySlug, type ProgramDef } from "./registry";
import type { CourseSection } from "@/lib/types";

export { PROGRAMS, getProgramBySlug };
export type { ProgramDef };

// Thin-content thresholds. Both must hold for a program page to render.
export const PROGRAM_MIN_COLLEGES = 3;
export const PROGRAM_MIN_SECTIONS = 5;

export type ProgramCollegeRow = {
  collegeCode: string;
  collegeName: string;
  collegeId: string;
  sectionCount: number;
  uniqueCourses: number;
  onlineCount: number;
};

export type ProgramData = {
  program: ProgramDef;
  matchedPrefixes: string[];
  totalSections: number;
  totalUniqueCourses: number;
  totalColleges: number;
  totalOnline: number;
  colleges: ProgramCollegeRow[];
  // Flattened sections across all matched prefixes for the program. Used
  // by the per-program landing page to compute an availability profile
  // (mode mix, time-of-day, start dates, instructor diversity) without
  // re-loading. Already in scope inside loadProgramData; returning it
  // here saves the page from a second round of Supabase calls.
  flatSections: CourseSection[];
  // Sample of representative courses for an ItemList block.
  sampleCourses: {
    prefix: string;
    number: string;
    title: string;
    sectionCount: number;
  }[];
};

/**
 * Pull every section across program candidate prefixes for a state+term.
 * Returns null if no data found at all (used for notFound discrimination).
 * Caller decides if the result clears the threshold via `qualifies()`.
 */
export async function loadProgramData(
  state: string,
  programSlug: string
): Promise<ProgramData | null> {
  const program = getProgramBySlug(programSlug);
  if (!program) return null;

  const term = await getCurrentTerm(state);
  const institutions = loadInstitutions(state);
  const sectionsPerPrefix = await Promise.all(
    program.prefixes.map(async (p) => ({
      prefix: p,
      sections: await loadCoursesBySubject(p, term, state),
    }))
  );

  const all: CourseSection[] = sectionsPerPrefix.flatMap((x) => x.sections);
  if (all.length === 0) return null;

  const matchedPrefixes = sectionsPerPrefix
    .filter((x) => x.sections.length > 0)
    .map((x) => x.prefix);

  // Aggregate by college
  const byCollege = new Map<string, CourseSection[]>();
  for (const s of all) {
    if (!byCollege.has(s.college_code)) byCollege.set(s.college_code, []);
    byCollege.get(s.college_code)!.push(s);
  }

  const colleges: ProgramCollegeRow[] = [];
  for (const [code, secs] of byCollege) {
    const inst = institutions.find(
      (i) => i.college_slug === code || i.id === code
    );
    if (!inst) continue; // skip orphaned college codes
    const uniqueCourses = new Set(
      secs.map((s) => `${s.course_prefix} ${s.course_number}`)
    ).size;
    const onlineCount = secs.filter(
      (s) => s.mode === "online" || s.mode === "zoom"
    ).length;
    colleges.push({
      collegeCode: code,
      collegeName: inst.name,
      collegeId: inst.id,
      sectionCount: secs.length,
      uniqueCourses,
      onlineCount,
    });
  }
  // Sort by section count descending, then name
  colleges.sort(
    (a, b) =>
      b.sectionCount - a.sectionCount ||
      a.collegeName.localeCompare(b.collegeName)
  );

  // Sample courses across the program — top by section count
  const courseMap = new Map<string, { title: string; count: number }>();
  for (const s of all) {
    const key = `${s.course_prefix} ${s.course_number}`;
    const existing = courseMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      courseMap.set(key, { title: s.course_title, count: 1 });
    }
  }
  const sampleCourses = [...courseMap.entries()]
    .map(([key, v]) => {
      const [prefix, number] = key.split(" ");
      return {
        prefix,
        number,
        title: v.title,
        sectionCount: v.count,
      };
    })
    .sort((a, b) => b.sectionCount - a.sectionCount)
    .slice(0, 12);

  return {
    program,
    matchedPrefixes,
    totalSections: all.length,
    totalUniqueCourses: courseMap.size,
    totalColleges: colleges.length,
    totalOnline: all.filter((s) => s.mode === "online" || s.mode === "zoom")
      .length,
    colleges,
    flatSections: all,
    sampleCourses,
  };
}

export function qualifies(data: ProgramData): boolean {
  if (data.totalColleges < PROGRAM_MIN_COLLEGES) return false;
  const eligibleColleges = data.colleges.filter(
    (c) => c.sectionCount >= PROGRAM_MIN_SECTIONS
  );
  return eligibleColleges.length >= PROGRAM_MIN_COLLEGES;
}

/**
 * Sitemap helper — for a state, return the slugs of all programs whose page
 * should be indexed. Calls loadProgramData per program; relies on the cache
 * inside loadCoursesBySubject so repeat calls during a sitemap build are
 * cheap.
 */
export async function getQualifyingProgramSlugs(
  state: string
): Promise<string[]> {
  const out: string[] = [];
  for (const program of PROGRAMS) {
    const data = await loadProgramData(state, program.slug);
    if (data && qualifies(data)) out.push(program.slug);
  }
  return out;
}
