/**
 * Server-side data layer for program/degree requirements.
 *
 * Reads from the `programs` table in Supabase (populated by the import
 * pipeline). Falls back to local JSON files when Supabase is unavailable
 * (same pattern as lib/transfer.ts).
 */

import * as fs from "fs";
import * as path from "path";
import { supabase } from "@/lib/supabase";
import { loadInstitutions } from "@/lib/institutions";
import { titleMatchesMajor } from "@/lib/programs/semantic-match";
import type {
  ProgramRequirement,
  RequirementGroup,
  RequiredCourse,
} from "@/lib/types";
import type { Institution } from "@/lib/types";

// Re-export types for convenience
export type { ProgramRequirement, RequirementGroup, RequiredCourse };

/**
 * Map of "PREFIX NUMBER" → section count for a given college + term.
 * Lets the UI show "8 sections available" or "not offered this term" per
 * required course.
 */
export type CourseAvailabilityMap = Map<string, number>;

interface ProgramRow {
  title: string;
  credential: string;
  program_code: string | null;
  catalog_url: string;
  total_credits: number | null;
  gpa_minimum: number | null;
  description: string | null;
  matched_program_slug: string | null;
  requirement_groups: RequirementGroup[];
  college_slug: string;
  catalog_year: string;
}

function rowToProgram(row: ProgramRow): ProgramRequirement {
  return {
    title: row.title,
    credential: row.credential as ProgramRequirement["credential"],
    program_code: row.program_code,
    catalog_url: row.catalog_url,
    total_credits: row.total_credits,
    gpa_minimum: row.gpa_minimum,
    description: row.description,
    matched_program_slug: row.matched_program_slug,
    requirement_groups: row.requirement_groups ?? [],
  };
}

/**
 * Load all programs at one college from Supabase, falling back to local JSON.
 */
export async function loadCollegePrograms(
  state: string,
  collegeSlug: string,
): Promise<ProgramRequirement[]> {
  try {
    const { data, error } = await supabase
      .from("programs")
      .select("*")
      .eq("state", state)
      .eq("college_slug", collegeSlug)
      .order("title");

    if (!error && data && data.length > 0) {
      return data.map(rowToProgram);
    }
  } catch {
    // Supabase unavailable — fall through to local JSON
  }

  return loadCollegeProgramsFromFile(state, collegeSlug);
}

/**
 * Load all colleges offering a given program category.
 * Returns programs grouped by college with institution metadata.
 */
export async function loadProgramAcrossColleges(
  state: string,
  programSlug: string,
): Promise<
  Array<{ college: Institution; programs: ProgramRequirement[] }>
> {
  let rows: ProgramRow[] = [];

  try {
    const { data, error } = await supabase
      .from("programs")
      .select("*")
      .eq("state", state)
      .eq("matched_program_slug", programSlug)
      .order("college_slug")
      .order("title");

    if (!error && data) {
      rows = data as ProgramRow[];
    }
  } catch {
    // Fall through to local JSON
  }

  if (rows.length === 0) {
    rows = loadProgramsBySlugFromFiles(state, programSlug);
  }

  if (rows.length === 0) return [];

  const institutions = loadInstitutions(state);
  const byCollege = new Map<string, ProgramRow[]>();
  for (const row of rows) {
    const slug = row.college_slug;
    if (!byCollege.has(slug)) byCollege.set(slug, []);
    byCollege.get(slug)!.push(row);
  }

  const results: Array<{
    college: Institution;
    programs: ProgramRequirement[];
  }> = [];

  for (const [slug, collegeRows] of byCollege) {
    const inst = institutions.find(
      (i) => i.college_slug === slug || i.id === slug,
    );
    if (!inst) continue;
    results.push({
      college: inst,
      programs: collegeRows.map(rowToProgram),
    });
  }

  return results.sort((a, b) => a.college.name.localeCompare(b.college.name));
}

// ---------------------------------------------------------------------------
// Local JSON fallbacks
// ---------------------------------------------------------------------------

function loadCollegeProgramsFromFile(
  state: string,
  collegeSlug: string,
): ProgramRequirement[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    state,
    "programs",
    `${collegeSlug}.json`,
  );
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    return (data.programs ?? []) as ProgramRequirement[];
  } catch {
    return [];
  }
}

function loadProgramsBySlugFromFiles(
  state: string,
  programSlug: string,
): ProgramRow[] {
  const dir = path.join(process.cwd(), "data", state, "programs");
  if (!fs.existsSync(dir)) return [];

  const rows: ProgramRow[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const data = JSON.parse(raw);
      const collegeSlug = file.replace(".json", "");
      for (const p of data.programs ?? []) {
        if (p.matched_program_slug === programSlug) {
          rows.push({ ...p, college_slug: collegeSlug, catalog_year: data.catalog_year ?? "" });
        }
      }
    } catch {
      continue;
    }
  }
  return rows;
}

/**
 * Find programs whose title loosely relates to a major term — used as a
 * fallback when no program in the state has matched_program_slug exactly
 * equal to the requested major. Stem-aware match (see semantic-match.ts):
 * "geography" matches "Geographic Information Systems", "biology" matches
 * "Biological Sciences", etc., across the common -y/-ic/-ical/-tion/-ing
 * morphology variations. Grouped by college; up to `limit` programs total.
 */
export async function findRelatedPrograms(
  state: string,
  majorTerm: string,
  limit = 8,
): Promise<Array<{ college: Institution; programs: ProgramRequirement[] }>> {
  const dir = path.join(process.cwd(), "data", state, "programs");
  if (!fs.existsSync(dir)) return [];

  const needle = majorTerm.replace(/-/g, " ").trim();
  if (!needle) return [];

  const institutions = loadInstitutions(state);
  const byCollege = new Map<string, ProgramRow[]>();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const data = JSON.parse(raw);
      const collegeSlug = file.replace(".json", "");
      for (const p of data.programs ?? []) {
        if (titleMatchesMajor(p.title ?? "", needle)) {
          if (!byCollege.has(collegeSlug)) byCollege.set(collegeSlug, []);
          byCollege.get(collegeSlug)!.push({
            ...p,
            college_slug: collegeSlug,
            catalog_year: data.catalog_year ?? "",
          });
        }
      }
    } catch {
      continue;
    }
  }

  const results: Array<{ college: Institution; programs: ProgramRequirement[] }> = [];
  let total = 0;
  for (const [slug, rows] of byCollege) {
    const inst = institutions.find(
      (i) => i.college_slug === slug || i.id === slug,
    );
    if (!inst) continue;
    const remaining = Math.max(0, limit - total);
    if (remaining === 0) break;
    const trimmed = rows.slice(0, remaining);
    results.push({ college: inst, programs: trimmed.map(rowToProgram) });
    total += trimmed.length;
  }
  return results.sort((a, b) => a.college.name.localeCompare(b.college.name));
}

/**
 * Whether a state has *any* program data on disk — used to distinguish
 * "no programs at all in this state" from "no programs match this major".
 */
export function stateHasProgramData(state: string): boolean {
  const dir = path.join(process.cwd(), "data", state, "programs");
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith(".json"));
}

/**
 * Look up programs by their literal `title` string within a state's program
 * data. Used by the Phase 3 semantic resolver: the LLM returns title
 * strings (verified-against-vocab), and we hydrate them here to full
 * `ProgramRequirement` objects with their college metadata. Returns the
 * same shape as findRelatedPrograms so callers stay uniform.
 *
 * Match is case-sensitive on title — the LLM is instructed to return
 * verbatim titles, and parseResponse in semantic-resolve validates against
 * the vocab before letting strings through.
 */
export async function loadProgramsByTitles(
  state: string,
  titles: string[],
): Promise<Array<{ college: Institution; programs: ProgramRequirement[] }>> {
  if (titles.length === 0) return [];
  const dir = path.join(process.cwd(), "data", state, "programs");
  if (!fs.existsSync(dir)) return [];

  const wanted = new Set(titles);
  const institutions = loadInstitutions(state);
  const byCollege = new Map<string, ProgramRow[]>();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const data = JSON.parse(raw);
      const collegeSlug = file.replace(".json", "");
      for (const p of data.programs ?? []) {
        if (typeof p?.title === "string" && wanted.has(p.title)) {
          if (!byCollege.has(collegeSlug)) byCollege.set(collegeSlug, []);
          byCollege.get(collegeSlug)!.push({
            ...p,
            college_slug: collegeSlug,
            catalog_year: data.catalog_year ?? "",
          });
        }
      }
    } catch {
      continue;
    }
  }

  const results: Array<{ college: Institution; programs: ProgramRequirement[] }> = [];
  for (const [slug, rows] of byCollege) {
    const inst = institutions.find(
      (i) => i.college_slug === slug || i.id === slug,
    );
    if (!inst) continue;
    results.push({ college: inst, programs: rows.map(rowToProgram) });
  }
  return results.sort((a, b) => a.college.name.localeCompare(b.college.name));
}

// ---------------------------------------------------------------------------
// Course availability — cross-reference requirements with live sections
// ---------------------------------------------------------------------------

function collectCourseCodes(programs: ProgramRequirement[]): string[] {
  const seen = new Set<string>();
  for (const prog of programs) {
    for (const group of prog.requirement_groups) {
      for (const course of group.courses) {
        seen.add(`${course.prefix} ${course.number}`);
        for (const alt of course.or_alternatives) {
          seen.add(`${alt.prefix} ${alt.number}`);
        }
      }
    }
  }
  return [...seen];
}

/**
 * For a given college + term, count how many sections exist for each
 * required course. Returns a map of "PREFIX NUMBER" → section count.
 */
export async function checkCourseAvailability(
  state: string,
  collegeSlug: string,
  term: string,
  programs: ProgramRequirement[],
): Promise<CourseAvailabilityMap> {
  const codes = collectCourseCodes(programs);
  if (codes.length === 0) return new Map();

  const prefixes = [...new Set(codes.map((c) => c.split(" ")[0]))];
  const numbers = [...new Set(codes.map((c) => c.split(" ")[1]))];

  try {
    const { data, error } = await supabase
      .from("courses")
      .select("course_prefix, course_number")
      .eq("state", state)
      .eq("college_code", collegeSlug)
      .eq("term", term)
      .in("course_prefix", prefixes)
      .in("course_number", numbers);

    if (error || !data) return new Map();

    const codeSet = new Set(codes);
    const counts = new Map<string, number>();
    for (const row of data) {
      const key = `${row.course_prefix} ${row.course_number}`;
      if (codeSet.has(key)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  } catch {
    return new Map();
  }
}
