/**
 * Shared Supabase import utilities for course scrapers.
 *
 * After scraping course data to JSON files, call `importCoursesToSupabase()`
 * to push the data into the live Supabase database — avoiding the manual
 * "forgot to run import-courses.ts" problem.
 *
 * Usage from any scraper:
 *   import { importCoursesToSupabase } from "../lib/supabase-import";
 *   // ... after writing JSON files ...
 *   await importCoursesToSupabase("nc");
 */

import * as fs from "fs";
import * as path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env";
import {
  CourseSectionSchema,
  TransferMappingSchema,
  CollegeProgramsSchema,
  ProgramRequirementSchema,
  MAX_INVALID_RATIO,
  validateRows,
  isTransferHeaderRow,
} from "../../lib/schemas";
import { buildImportUnits, type RawTermFile } from "./canonical-term";

const BATCH_SIZE = 500;

// Change-detection thresholds (issue #51). A scraper that produces a
// dramatically smaller dataset than what's already in Supabase is almost
// always broken (expired auth cookie, source site offline, parser regression).
// Keyed off incoming/existing ratio:
//   < ABORT_RATIO   → refuse to import; require --force
//   < WARN_RATIO    → proceed with a loud warning
//   >= WARN_RATIO   → proceed silently (normal churn or growth)
const ABORT_RATIO = 0.5;
const WARN_RATIO = 0.9;

/**
 * Compare incoming row count against what's currently in Supabase for
 * the given filter. Returns `{ ok, existing, message }` — if `ok` is
 * false, caller should skip the import (or respect `--force`).
 */
export async function changeDetection(
  sb: SupabaseClient,
  table: "courses" | "transfers" | "programs",
  filter: Record<string, string>,
  incoming: number,
  label: string,
  force: boolean
): Promise<{ ok: boolean; existing: number; message: string }> {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter)) {
    q = q.eq(k, v);
  }
  const { count, error } = await q;
  if (error) {
    return {
      ok: true,
      existing: 0,
      message: `  (change-detection skipped for ${label}: ${error.message})`,
    };
  }
  const existing = count ?? 0;

  // First-time import (nothing to compare against) always proceeds.
  if (existing === 0) {
    return { ok: true, existing: 0, message: "" };
  }

  const ratio = incoming / existing;
  const pct = (ratio * 100).toFixed(1);
  const delta = incoming - existing;
  const diff = `incoming ${incoming} vs. existing ${existing} (${delta >= 0 ? "+" : ""}${delta}, ${pct}%)`;

  if (ratio < ABORT_RATIO) {
    if (force) {
      return {
        ok: true,
        existing,
        message: `  FORCE ${label}: ${diff} — would have aborted (<${(ABORT_RATIO * 100).toFixed(0)}%), proceeding due to --force.`,
      };
    }
    return {
      ok: false,
      existing,
      message: `  ABORT ${label}: ${diff} — below ${(ABORT_RATIO * 100).toFixed(0)}% threshold. Scraper likely broken. Re-run --force to override.`,
    };
  }
  if (ratio < WARN_RATIO) {
    return {
      ok: true,
      existing,
      message: `  WARN  ${label}: ${diff} — under ${(WARN_RATIO * 100).toFixed(0)}% of prior, proceeding.`,
    };
  }
  return { ok: true, existing, message: "" };
}

function getSupabase(): SupabaseClient {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Course import
// ---------------------------------------------------------------------------

interface CourseRow {
  state: string;
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string | null;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

/**
 * Import all course JSON files for a state into Supabase.
 * Reads from data/{state}/courses/{slug}/{term}.json and upserts into the
 * `courses` table (delete-then-insert per college+term).
 */
export async function importCoursesToSupabase(
  state: string,
  opts: { force?: boolean; dryRun?: boolean } = {}
): Promise<number> {
  const force = !!opts.force;
  const dryRun = !!opts.dryRun;
  let sb: SupabaseClient;
  try {
    sb = getSupabase();
  } catch (e) {
    console.log(`\n  Supabase import skipped: ${(e as Error).message}`);
    return 0;
  }

  const coursesDir = path.join(process.cwd(), "data", state, "courses");
  if (!fs.existsSync(coursesDir)) {
    console.log(`  No courses directory for ${state}, skipping import.`);
    return 0;
  }

  const collegeSlugs = fs.readdirSync(coursesDir).filter((s) => {
    return fs.statSync(path.join(coursesDir, s)).isDirectory();
  });

  console.log(
    `\nImporting ${state.toUpperCase()} into Supabase: ${collegeSlugs.length} college(s)`
  );

  let totalInserted = 0;

  for (const slug of collegeSlugs) {
    const collegeDir = path.join(coursesDir, slug);
    const termFiles = fs
      .readdirSync(collegeDir)
      .filter((f) => f.endsWith(".json"));

    // Read every term file, then resolve them into (term, rows) import units.
    // For colleges with at least one canonical term file this is one unit per
    // file with term = filename stem — identical to the legacy path. Only
    // fully-invisible colleges (no canonical term at all) get their terms
    // canonicalized + merged here, so they stop importing under terms search
    // never queries. See buildImportUnits in lib/canonical-term.ts.
    const rawFiles: RawTermFile[] = [];
    for (const file of termFiles) {
      const raw = fs.readFileSync(path.join(collegeDir, file), "utf-8");
      const sections = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (sections.length === 0) continue;
      rawFiles.push({ stem: file.replace(".json", ""), sections });
    }
    const units = buildImportUnits(rawFiles);
    for (const u of units.filter((u) => u.canonicalized)) {
      console.log(
        `  CANONICALIZED ${slug}: -> ${u.term} (${u.sections.length} rows from non-canonical term file(s))`
      );
    }

    for (const unit of units) {
      const term = unit.term;
      const sections = unit.sections as Array<Record<string, unknown>>;

      if (sections.length === 0) continue;

      // Dry-run: show what WOULD change vs. what's in Supabase now, write
      // nothing. Lets you preview the canonicalization against prod safely
      // (npm run import:courses -- --state mi --dry-run).
      if (dryRun) {
        const { count } = await sb
          .from("courses")
          .select("id", { count: "exact", head: true })
          .eq("state", state)
          .eq("college_code", slug)
          .eq("term", term);
        const tag = unit.canonicalized ? " [canonicalized]" : "";
        console.log(
          `  [dry-run] ${slug}/${term}: existing ${count ?? 0} -> incoming ${sections.length}${tag}`
        );
        continue;
      }

      // Change-detection preflight: if incoming is far below existing,
      // the scraper is probably broken. Abort unless --force. See issue #51.
      const cd = await changeDetection(
        sb,
        "courses",
        { state, college_code: slug, term },
        sections.length,
        `${slug}/${term}`,
        force
      );
      if (cd.message) console.log(cd.message);
      if (!cd.ok) continue;

      // Schema-validate every section before touching Supabase. If >5% fail,
      // abort this (college, term) entirely — the scraper is broken and
      // half-importing would replace good cloud data with partial data.
      // If <5% fail, log and skip the bad rows so one malformed section
      // doesn't block an otherwise-good import. See issue #49.
      const validation = validateRows(
        sections,
        CourseSectionSchema,
        (row, i) => {
          const r = row as Record<string, unknown>;
          const label = r.crn ? `CRN ${r.crn}` : `row ${i}`;
          const course = r.course_prefix && r.course_number
            ? `${r.course_prefix} ${r.course_number}`
            : "<unknown course>";
          return `${slug}/${term} ${course} ${label}`;
        }
      );

      const invalidRatio = validation.invalid.length / sections.length;
      if (validation.invalid.length > 0) {
        console.warn(
          `  SCHEMA ${slug}/${term}: ${validation.invalid.length}/${sections.length} rows failed validation (${(invalidRatio * 100).toFixed(1)}%)`
        );
        for (const bad of validation.invalid.slice(0, 10)) {
          console.warn(`    - ${bad.identity}: ${bad.errors.join("; ")}`);
        }
        if (validation.invalid.length > 10) {
          console.warn(
            `    - ...and ${validation.invalid.length - 10} more`
          );
        }
      }

      if (invalidRatio > MAX_INVALID_RATIO) {
        console.error(
          `  ABORT ${slug}/${term}: invalid-row ratio ${(invalidRatio * 100).toFixed(1)}% exceeds ${(MAX_INVALID_RATIO * 100).toFixed(0)}% threshold. Fix the scraper and re-run. Cloud data for this (college, term) is unchanged.`
        );
        continue;
      }

      // Delete existing rows for this (state, college, term)
      const { error: delError } = await sb
        .from("courses")
        .delete()
        .eq("state", state)
        .eq("college_code", slug)
        .eq("term", term);

      if (delError) {
        console.error(`  Error deleting ${slug}/${term}:`, delError.message);
        continue;
      }

      // Prepare rows. The filename-derived `term` and directory-derived
      // `slug` are authoritative — do NOT fall through to a row-level value.
      // A scraper that wrote a non-canonical term inside the JSON (e.g.
      // "26/FA" instead of "2026FA") used to silently corrupt the cloud
      // because the delete-then-insert flow keys deletes off the filename
      // term but inserts off the row term — leaving stale rows forever. Same
      // for college_code: if a scraper wrote the wrong slug, future imports
      // never clean it up. Always trust the directory structure.
      const validatedSections = validation.valid;
      if (validatedSections.length === 0) continue;

      let rowTermOverrides = 0;
      let rowSlugOverrides = 0;
      const rows: CourseRow[] = validatedSections.map((s) => {
        if (s.term && s.term !== term) rowTermOverrides++;
        if (s.college_code && s.college_code !== slug) rowSlugOverrides++;
        return {
        state,
        college_code: slug,
        term: term,
        course_prefix: (s.course_prefix as string) || "",
        course_number: (s.course_number as string) || "",
        course_title: (s.course_title as string) || "",
        credits: (s.credits as number) || 0,
        crn: (s.crn as string) || "",
        days: (s.days as string) || "",
        start_time: (s.start_time as string) || "",
        end_time: (s.end_time as string) || "",
        start_date: (s.start_date as string) || null,
        location: (s.location as string) || "",
        campus: (s.campus as string) || "",
        mode: (s.mode as string) || "in-person",
        instructor: (s.instructor as string) || null,
        seats_open: s.seats_open != null ? (s.seats_open as number) : null,
        seats_total: s.seats_total != null ? (s.seats_total as number) : null,
        prerequisite_text: (s.prerequisite_text as string) || null,
        prerequisite_courses: (s.prerequisite_courses as string[]) || [],
      };
      });

      if (rowTermOverrides > 0) {
        console.warn(
          `  WARN ${slug}/${term}: ${rowTermOverrides} rows had a non-canonical 'term' field; overridden by filename term.`
        );
      }
      if (rowSlugOverrides > 0) {
        console.warn(
          `  WARN ${slug}/${term}: ${rowSlugOverrides} rows had a non-canonical 'college_code' field; overridden by directory slug.`
        );
      }

      // Insert in batches — abort on first failure to limit data loss
      let inserted = 0;
      let aborted = false;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error: insError } = await sb.from("courses").insert(batch);
        if (insError) {
          console.error(
            `  FATAL: Insert failed for ${slug}/${term} batch ${i}: ${insError.message}`
          );
          console.error(
            `  WARNING: ${rows.length - inserted} rows lost — delete already committed.`
          );
          aborted = true;
          break;
        }
        inserted += batch.length;
      }
      if (aborted) {
        console.error(`  Aborting remaining batches for ${slug}/${term}.`);
      }

      totalInserted += inserted;
      console.log(`  ${slug}/${term}: ${inserted} sections`);
    }
  }

  console.log(`  Total for ${state.toUpperCase()}: ${totalInserted} sections`);
  return totalInserted;
}

// ---------------------------------------------------------------------------
// Transfer import
// ---------------------------------------------------------------------------

interface TransferRow {
  state: string;
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

/**
 * Import transfer equivalency data for a state into Supabase.
 * Reads from data/{state}/transfer-equiv.json.
 */
export async function importTransfersToSupabase(
  state: string,
  opts: { force?: boolean } = {}
): Promise<number> {
  const force = !!opts.force;
  let sb: SupabaseClient;
  try {
    sb = getSupabase();
  } catch (e) {
    console.log(`\n  Supabase transfer import skipped: ${(e as Error).message}`);
    return 0;
  }

  const filePath = path.join(
    process.cwd(),
    "data",
    state,
    "transfer-equiv.json"
  );
  if (!fs.existsSync(filePath)) {
    console.log(`  No transfer-equiv.json for ${state}, skipping.`);
    return 0;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const mappings = JSON.parse(raw) as Array<Record<string, unknown>>;

  // Skip header row if present (cc_prefix === "VCCS" or similar header-like value)
  const data = mappings.filter((m) => !isTransferHeaderRow(m));

  if (data.length === 0) {
    console.log(`  No transfer mappings for ${state}.`);
    return 0;
  }

  // Change-detection preflight (issue #51).
  const cd = await changeDetection(
    sb,
    "transfers",
    { state },
    data.length,
    `${state} transfers`,
    force
  );
  if (cd.message) console.log(cd.message);
  if (!cd.ok) return 0;

  // Schema-validate. Same 5% abort threshold as course import (issue #49).
  const validation = validateRows(
    data,
    TransferMappingSchema,
    (row, i) => {
      const r = row as Record<string, unknown>;
      const cc = r.cc_course || `${r.cc_prefix ?? "?"} ${r.cc_number ?? "?"}`;
      return `${state} ${cc} -> ${r.university ?? "?"} (row ${i})`;
    }
  );

  const invalidRatio = validation.invalid.length / data.length;
  if (validation.invalid.length > 0) {
    console.warn(
      `  SCHEMA ${state} transfers: ${validation.invalid.length}/${data.length} rows failed validation (${(invalidRatio * 100).toFixed(1)}%)`
    );
    for (const bad of validation.invalid.slice(0, 10)) {
      console.warn(`    - ${bad.identity}: ${bad.errors.join("; ")}`);
    }
    if (validation.invalid.length > 10) {
      console.warn(`    - ...and ${validation.invalid.length - 10} more`);
    }
  }

  if (invalidRatio > MAX_INVALID_RATIO) {
    console.error(
      `  ABORT ${state} transfers: invalid-row ratio ${(invalidRatio * 100).toFixed(1)}% exceeds ${(MAX_INVALID_RATIO * 100).toFixed(0)}% threshold. Fix the scraper and re-run. Cloud transfer data for this state is unchanged.`
    );
    return 0;
  }

  const validated = validation.valid;
  if (validated.length === 0) {
    console.log(`  No valid transfer mappings for ${state} after validation.`);
    return 0;
  }

  console.log(
    `\nImporting ${state.toUpperCase()} transfers into Supabase: ${validated.length} mappings`
  );

  // Delete existing rows for this state
  const { error: delError } = await sb
    .from("transfers")
    .delete()
    .eq("state", state);

  if (delError) {
    console.error(`  Error deleting ${state} transfers:`, delError.message);
    return 0;
  }

  // Prepare rows
  const rows: TransferRow[] = validated.map((m) => ({
    state,
    cc_prefix: m.cc_prefix,
    cc_number: m.cc_number,
    cc_course: m.cc_course,
    cc_title: m.cc_title,
    cc_credits: m.cc_credits,
    university: m.university,
    university_name: m.university_name,
    univ_course: m.univ_course,
    univ_title: m.univ_title,
    univ_credits: m.univ_credits,
    notes: m.notes,
    no_credit: m.no_credit,
    is_elective: m.is_elective,
  }));

  // Insert in batches with retry — abort after retries exhausted
  const MAX_RETRIES = 3;
  let totalInserted = 0;
  let aborted = false;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const { error: insError } = await sb.from("transfers").insert(batch);
      if (!insError) {
        succeeded = true;
        break;
      }
      if (attempt < MAX_RETRIES) {
        console.warn(
          `  Batch ${i} attempt ${attempt} failed: ${insError.message} — retrying in ${attempt * 2}s...`
        );
        await new Promise((r) => setTimeout(r, attempt * 2000));
      } else {
        console.error(
          `  FATAL: Insert failed for ${state} transfers batch ${i} after ${MAX_RETRIES} attempts: ${insError.message}`
        );
        console.error(
          `  WARNING: ${rows.length - totalInserted} rows lost — delete already committed.`
        );
        aborted = true;
      }
    }
    if (aborted) break;
    if (succeeded) totalInserted += batch.length;
  }
  if (aborted) {
    console.error(`  Aborting remaining transfer batches for ${state}.`);
  }

  console.log(`  Total transfers for ${state.toUpperCase()}: ${totalInserted}`);
  return totalInserted;
}

// ---------------------------------------------------------------------------
// Program import
// ---------------------------------------------------------------------------

interface ProgramRow {
  state: string;
  college_slug: string;
  catalog_year: string;
  title: string;
  credential: string;
  program_code: string | null;
  catalog_url: string;
  total_credits: number | null;
  gpa_minimum: number | null;
  description: string | null;
  matched_program_slug: string | null;
  requirement_groups: unknown;
  scraped_at: string;
}

/**
 * Import program requirement data for a state into Supabase.
 * Reads from data/{state}/programs/{college_slug}.json — one file per college.
 */
export async function importProgramsToSupabase(
  state: string,
  opts: { force?: boolean } = {}
): Promise<number> {
  const force = !!opts.force;
  let sb: SupabaseClient;
  try {
    sb = getSupabase();
  } catch (e) {
    console.log(`\n  Supabase program import skipped: ${(e as Error).message}`);
    return 0;
  }

  const programsDir = path.join(process.cwd(), "data", state, "programs");
  if (!fs.existsSync(programsDir)) {
    console.log(`  No programs directory for ${state}, skipping import.`);
    return 0;
  }

  const files = fs
    .readdirSync(programsDir)
    .filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log(`  No program files for ${state}.`);
    return 0;
  }

  console.log(
    `\nImporting ${state.toUpperCase()} programs into Supabase: ${files.length} college(s)`
  );

  let totalInserted = 0;

  for (const file of files) {
    const collegeSlug = file.replace(".json", "");
    const filePath = path.join(programsDir, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate the top-level CollegePrograms envelope
    const envelope = CollegeProgramsSchema.safeParse(parsed);
    if (!envelope.success) {
      console.error(
        `  SKIP ${collegeSlug}: envelope validation failed — ${envelope.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      );
      continue;
    }

    const collegeData = envelope.data;
    const programs = collegeData.programs;
    if (programs.length === 0) continue;

    // Change-detection preflight
    const cd = await changeDetection(
      sb,
      "programs",
      { state, college_slug: collegeSlug },
      programs.length,
      `${collegeSlug} programs`,
      force
    );
    if (cd.message) console.log(cd.message);
    if (!cd.ok) continue;

    // Row-level validation (individual programs)
    const validation = validateRows(
      programs,
      ProgramRequirementSchema,
      (row, i) => {
        const r = row as Record<string, unknown>;
        return `${collegeSlug} "${r.title ?? `program ${i}`}"`;
      }
    );

    const invalidRatio =
      validation.invalid.length / programs.length;
    if (validation.invalid.length > 0) {
      console.warn(
        `  SCHEMA ${collegeSlug} programs: ${validation.invalid.length}/${programs.length} rows failed (${(invalidRatio * 100).toFixed(1)}%)`
      );
      for (const bad of validation.invalid.slice(0, 10)) {
        console.warn(`    - ${bad.identity}: ${bad.errors.join("; ")}`);
      }
      if (validation.invalid.length > 10) {
        console.warn(
          `    - ...and ${validation.invalid.length - 10} more`
        );
      }
    }

    if (invalidRatio > MAX_INVALID_RATIO) {
      console.error(
        `  ABORT ${collegeSlug} programs: invalid-row ratio ${(invalidRatio * 100).toFixed(1)}% exceeds ${(MAX_INVALID_RATIO * 100).toFixed(0)}% threshold. Cloud data unchanged.`
      );
      continue;
    }

    const validated = validation.valid;
    if (validated.length === 0) continue;

    // Delete existing rows for this (state, college_slug)
    const { error: delError } = await sb
      .from("programs")
      .delete()
      .eq("state", state)
      .eq("college_slug", collegeSlug);

    if (delError) {
      console.error(
        `  Error deleting ${collegeSlug} programs:`,
        delError.message
      );
      continue;
    }

    // Prepare rows
    const rows: ProgramRow[] = validated.map((p) => ({
      state,
      college_slug: collegeSlug,
      catalog_year: collegeData.catalog_year,
      title: p.title,
      credential: p.credential,
      program_code: p.program_code,
      catalog_url: p.catalog_url,
      total_credits: p.total_credits,
      gpa_minimum: p.gpa_minimum,
      description: p.description,
      matched_program_slug: p.matched_program_slug,
      requirement_groups: p.requirement_groups,
      scraped_at: collegeData.scraped_at,
    }));

    // Insert in batches
    let inserted = 0;
    let aborted = false;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insError } = await sb.from("programs").insert(batch);
      if (insError) {
        console.error(
          `  FATAL: Insert failed for ${collegeSlug} programs batch ${i}: ${insError.message}`
        );
        console.error(
          `  WARNING: ${rows.length - inserted} rows lost — delete already committed.`
        );
        aborted = true;
        break;
      }
      inserted += batch.length;
    }
    if (aborted) {
      console.error(
        `  Aborting remaining batches for ${collegeSlug} programs.`
      );
    }

    totalInserted += inserted;
    console.log(`  ${collegeSlug}: ${inserted} programs`);
  }

  console.log(
    `  Total programs for ${state.toUpperCase()}: ${totalInserted}`
  );
  return totalInserted;
}
