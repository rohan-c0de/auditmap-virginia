/**
 * Transfer-Validated Major Plan — Phase 1 of the Degree-Path Planner.
 *
 * Joins three datasets we already hold, for ONE college program:
 *   1. programs   (data/{state}/programs/{college}.json) — what's required
 *   2. transfer   (data/{state}/transfer-equiv.json)     — will it transfer
 *   3. sections   (data/{state}/courses/{college}/*.json) — offered this term
 *
 * The result is a per-course checklist: each required course shows whether it
 * transfers to the student's target university (direct / elective / no-credit /
 * unknown) and how many live sections exist. Prereq-based term *sequencing* is
 * deliberately NOT attempted here — see project memory: national inline-prereq
 * coverage is too thin (42% of colleges at 0%) to sequence reliably. Phase 2
 * layers that in, piloting in GA where all four datasets line up.
 *
 * Data-honesty rule (CLAUDE.md invariant #4): never fabricate a course or a
 * transfer match. Un-enumerated requirement groups (e.g. "choose from Gen-Ed")
 * are surfaced honestly as having no listed courses rather than invented.
 */

import * as fs from "fs";
import * as path from "path";
import { loadCollegePrograms } from "@/lib/programs/requirements";
import { loadTransferMappings } from "@/lib/transfer";
import { loadInstitutions } from "@/lib/institutions";
import { getCurrentTerm } from "@/lib/terms";
import {
  isRealCourse,
  countRealCourses,
  programSlug,
  PLAN_MIN_COURSES,
} from "@/lib/programs/plan-shared";
import type { RequiredCourse } from "@/lib/types";

// Re-export the pure helpers so existing `@/lib/programs/planner` imports work.
export { isRealCourse, countRealCourses, programSlug, PLAN_MIN_COURSES };

export type TransferStatus = "direct" | "elective" | "no-credit";

/** One university's verdict on a single required course. */
export interface CourseTransfer {
  universitySlug: string;
  universityName: string;
  status: TransferStatus;
  /** The receiving course code, e.g. "ACCT 2101" or "BUS 1XXX". */
  univCourse: string;
}

export interface PlanCourse {
  prefix: string;
  number: string;
  code: string; // "PREFIX NUMBER"
  title: string;
  credits: number | null;
  alternatives: Array<{ prefix: string; number: string; title: string }>;
  /** Per-university transfer verdicts, keyed by university slug. Tiny payload. */
  transfers: Record<string, CourseTransfer>;
  /** Distinct universities that grant *some* credit (direct or elective). */
  acceptingCount: number;
  /** Live sections at this college in the active term. */
  sectionsThisTerm: number;
}

export interface PlanGroup {
  name: string;
  creditsRequired: number | null;
  chooseN: number | null;
  courses: PlanCourse[];
  /** True when the catalog group lists no concrete courses (e.g. gen-ed pick). */
  unenumerated: boolean;
}

export interface PlanUniversity {
  slug: string;
  name: string;
  /** How many of this program's required courses transfer to this university. */
  accepts: number;
}

export interface MajorPlan {
  state: string;
  collegeId: string;
  collegeName: string;
  collegeSlug: string;
  term: string;
  program: {
    title: string;
    credential: string;
    slug: string;
    catalogUrl: string;
    totalCredits: number | null;
    gpaMinimum: number | null;
  };
  groups: PlanGroup[];
  /** Universities that accept ≥1 required course, ranked by coverage. */
  universities: PlanUniversity[];
  totals: {
    listedCourses: number;
    offeredThisTerm: number;
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Join key: uppercase, whitespace-stripped. "MGMT 1100" → "MGMT1100". */
function joinKey(prefix: string, number: string): string {
  return `${prefix}${number}`.toUpperCase().replace(/\s+/g, "");
}

/** Count sections per course code for a college+term, read from local JSON. */
function sectionCountsFromFiles(
  state: string,
  collegeSlug: string,
  term: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const file = path.join(
    process.cwd(),
    "data",
    state,
    "courses",
    collegeSlug,
    `${term}.json`,
  );
  if (!fs.existsSync(file)) return counts;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as
      | Array<Record<string, unknown>>
      | { sections?: Array<Record<string, unknown>> };
    const sections = Array.isArray(raw) ? raw : (raw.sections ?? []);
    for (const s of sections) {
      const key = joinKey(String(s.course_prefix ?? ""), String(s.course_number ?? ""));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } catch {
    // unreadable term file — treat as no availability data
  }
  return counts;
}

/** Pick the most relevant term that actually has a JSON file for this college. */
function resolveTerm(
  state: string,
  collegeSlug: string,
  preferred: string,
): string | null {
  const dir = path.join(process.cwd(), "data", state, "courses", collegeSlug);
  if (!fs.existsSync(dir)) return null;
  const terms = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  if (terms.length === 0) return null;
  if (terms.includes(preferred)) return preferred;
  // Otherwise the lexicographically-largest term code (e.g. 2026SU > 2026SP).
  return terms.sort()[terms.length - 1];
}

// ── program discovery ───────────────────────────────────────────────────────

/** Programs at a college that have enough real courses to build a plan. */
export async function listPlannableProgramsForCollege(
  state: string,
  collegeSlug: string,
): Promise<Array<{ slug: string; title: string; credential: string; courseCount: number }>> {
  const programs = await loadCollegePrograms(state, collegeSlug);
  const out: Array<{ slug: string; title: string; credential: string; courseCount: number }> = [];
  for (const p of programs) {
    const courseCount = countRealCourses(p);
    if (courseCount >= PLAN_MIN_COURSES) {
      out.push({ slug: programSlug(p), title: p.title, credential: p.credential, courseCount });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ── the join ────────────────────────────────────────────────────────────────

/**
 * Build the transfer-validated plan for one college program. Returns null when
 * the college, program, or program's real-course list can't be resolved
 * (callers should `notFound()`).
 */
export async function buildMajorPlan(
  state: string,
  collegeId: string,
  slug: string,
): Promise<MajorPlan | null> {
  const institution = loadInstitutions(state).find((i) => i.id === collegeId);
  if (!institution) return null;
  const collegeSlug = institution.college_slug;

  const programs = await loadCollegePrograms(state, collegeSlug);
  const program = programs.find((p) => programSlug(p) === slug);
  if (!program) return null;

  // Gate on real courses — never render a plan from placeholders.
  if (countRealCourses(program) < PLAN_MIN_COURSES) return null;

  // Sections for the active term (local JSON; bundled in prod).
  const preferredTerm = await getCurrentTerm(state).catch(() => "");
  const term = resolveTerm(state, collegeSlug, preferredTerm) ?? preferredTerm;
  const sectionCounts = term ? sectionCountsFromFiles(state, collegeSlug, term) : new Map();

  // Index transfer mappings by join key for fast per-course lookup.
  const mappings = await loadTransferMappings(state);
  const transferIndex = new Map<string, CourseTransfer[]>();
  for (const m of mappings) {
    const key = joinKey(m.cc_prefix, m.cc_number);
    const status: TransferStatus = m.no_credit
      ? "no-credit"
      : m.is_elective
        ? "elective"
        : "direct";
    const arr = transferIndex.get(key) ?? [];
    arr.push({
      universitySlug: m.university,
      universityName: m.university_name,
      status,
      univCourse: m.univ_course,
    });
    transferIndex.set(key, arr);
  }

  const uniCoverage = new Map<string, { name: string; accepts: number }>();
  let offeredThisTerm = 0;
  let listedCourses = 0;

  const groups: PlanGroup[] = program.requirement_groups.map((g) => {
    const real = g.courses.filter(isRealCourse);
    const courses: PlanCourse[] = real.map((c: RequiredCourse) => {
      const key = joinKey(c.prefix, c.number);
      const rawMappings = transferIndex.get(key) ?? [];

      // Collapse to one verdict per university (prefer direct > elective > no-credit).
      const byUni: Record<string, CourseTransfer> = {};
      for (const t of rawMappings) {
        const existing = byUni[t.universitySlug];
        if (!existing || rank(t.status) < rank(existing.status)) {
          byUni[t.universitySlug] = t;
        }
      }

      let acceptingCount = 0;
      for (const t of Object.values(byUni)) {
        if (t.status !== "no-credit") {
          acceptingCount += 1;
          const cov = uniCoverage.get(t.universitySlug) ?? { name: t.universityName, accepts: 0 };
          cov.accepts += 1;
          uniCoverage.set(t.universitySlug, cov);
        }
      }

      const sections = sectionCounts.get(key) ?? 0;
      if (sections > 0) offeredThisTerm += 1;
      listedCourses += 1;

      return {
        prefix: c.prefix,
        number: c.number,
        code: `${c.prefix} ${c.number}`,
        title: c.title,
        credits: c.credits,
        alternatives: c.or_alternatives ?? [],
        transfers: byUni,
        acceptingCount,
        sectionsThisTerm: sections,
      };
    });

    return {
      name: g.name,
      creditsRequired: g.credits_required,
      chooseN: g.choose_n,
      courses,
      unenumerated: real.length === 0,
    };
  });

  const universities: PlanUniversity[] = [...uniCoverage.entries()]
    .map(([slugU, v]) => ({ slug: slugU, name: v.name, accepts: v.accepts }))
    .sort((a, b) => b.accepts - a.accepts || a.name.localeCompare(b.name));

  return {
    state,
    collegeId,
    collegeName: institution.name,
    collegeSlug,
    term,
    program: {
      title: program.title,
      credential: program.credential,
      slug,
      catalogUrl: program.catalog_url,
      totalCredits: program.total_credits,
      gpaMinimum: program.gpa_minimum,
    },
    groups,
    universities,
    totals: { listedCourses, offeredThisTerm },
  };
}

/** direct beats elective beats no-credit when a course maps multiple ways. */
function rank(s: TransferStatus): number {
  return s === "direct" ? 0 : s === "elective" ? 1 : 2;
}
