/**
 * aggregate-prereqs.ts
 *
 * Reads all per-college course section JSON files for a given state and
 * aggregates prerequisite data into a single `data/{state}/prereqs.json`
 * keyed by course code (e.g., "ACC 211").
 *
 * This is a generic script that works for any state whose scraper stores
 * `prerequisite_text` and `prerequisite_courses` in the section JSON files.
 * Currently applicable to: VA, NC, SC, GA, DC (and any future state whose
 * scraper populates those fields).
 *
 * States whose StateConfig declares dedicated prereq scrape jobs
 * (`scrapers.prereqs` is an array — MA, TX, CT, …) are SKIPPED unless
 * --force is passed: their catalog scrapers merge into prereqs.json
 * themselves, and a section-derived rebuild would clobber that richer
 * output. The 2026-06 scheduled-scrape runs did exactly that — MA dropped
 * 1946→1020 keys (every gcc/middlesex catalog entry deleted) because this
 * script ran unconditionally for every state on the prereqs cron tick and
 * the result sat just above the 50% safety net below.
 *
 * Usage:
 *   npx tsx scripts/lib/aggregate-prereqs.ts va
 *   npx tsx scripts/lib/aggregate-prereqs.ts nc sc ga dc
 *   npx tsx scripts/lib/aggregate-prereqs.ts --all
 */

import * as fs from "fs";
import * as path from "path";
import { getAllStates, getStateConfig } from "../../lib/states/registry";
import { sanitizePrereqEntry } from "./prereq-sanitize";

interface CourseSection {
  course_prefix: string;
  course_number: string;
  prerequisite_text?: string;
  prerequisite_courses?: string[];
}

export interface PrereqEntry {
  text: string;
  courses: string[];
  /** Set by dedicated catalog scrapers (e.g. "gcc", "middlesex") — never by aggregation. */
  source?: string;
}

export function mergePrereq(
  prereqs: Record<string, PrereqEntry>,
  key: string,
  text: string,
  courses: string[],
): void {
  if (prereqs[key]) {
    const existing = prereqs[key];
    if (courses.length > existing.courses.length) {
      prereqs[key] = {
        text: text || existing.text,
        courses,
      };
    }
  } else {
    prereqs[key] = { text, courses };
  }
}

/**
 * Carry `source`-tagged entries from the committed prereqs.json into a
 * fresh section-derived rebuild. Aggregation can only see what the course
 * sections carry, so without this step a rebuild silently deletes
 * everything a dedicated catalog scraper contributed.
 *
 * Collision convention mirrors the catalog scrapers themselves
 * (scripts/ma/scrape-catalog-prereqs-gcc.ts): a sourced entry whose plain
 * key is taken by an aggregate entry is stashed under "{source}:{key}".
 */
export function preserveSourcedEntries(
  rebuilt: Record<string, PrereqEntry>,
  existing: Record<string, PrereqEntry>,
): { merged: Record<string, PrereqEntry>; preserved: number } {
  const merged: Record<string, PrereqEntry> = { ...rebuilt };
  let preserved = 0;
  for (const [key, entry] of Object.entries(existing)) {
    if (!entry || typeof entry !== "object" || !entry.source) continue;
    if (!merged[key]) {
      merged[key] = entry;
      preserved++;
    } else if (!merged[key].source) {
      const slot = key.startsWith(`${entry.source}:`)
        ? key
        : `${entry.source}:${key}`;
      if (!merged[slot]) {
        merged[slot] = entry;
        preserved++;
      }
    }
  }
  return { merged, preserved };
}

/** True when the state's registry config declares dedicated prereq scrape jobs. */
export function hasScriptedPrereqs(state: string): boolean {
  let cfg;
  try {
    cfg = getStateConfig(state);
  } catch {
    return false;
  }
  return Array.isArray(cfg?.scrapers?.prereqs);
}

function readJsonObject(
  filePath: string,
): Record<string, PrereqEntry> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function aggregateState(
  state: string,
  opts: { force?: boolean; rootDir?: string } = {},
): number {
  const root = opts.rootDir ?? process.cwd();
  const outPath = path.join(root, "data", state, "prereqs.json");
  const existing = readJsonObject(outPath) ?? {};
  const existingCount = Object.keys(existing).length;

  // Dedicated catalog scrapers own this state's prereqs.json — they merge
  // into it themselves. A section-derived rebuild would delete their
  // entries (CLAUDE.md invariant #4: a failed/absent scrape must never
  // replace good data). Cron calls this script for every state on the
  // prereqs tick, so the guard lives here, not in workflow YAML.
  if (hasScriptedPrereqs(state) && !opts.force) {
    console.log(
      `  ${state}: skipped — StateConfig declares dedicated prereq scrape ` +
        `job(s) that merge into prereqs.json directly; a course-section ` +
        `rebuild would clobber their output (kept ${existingCount} entries). ` +
        `Pass --force to rebuild anyway.`,
    );
    return existingCount;
  }

  const dataDir = path.join(root, "data", state, "courses");
  if (!fs.existsSync(dataDir)) {
    console.error(`  No course data directory: ${dataDir}`);
    return 0;
  }

  const prereqs: Record<string, PrereqEntry> = {};
  let totalSections = 0;
  let withPrereqs = 0;

  // Walk all college directories
  const colleges = fs.readdirSync(dataDir).filter((f) => {
    const fullPath = path.join(dataDir, f);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const college of colleges) {
    const collegeDir = path.join(dataDir, college);
    const jsonFiles = fs
      .readdirSync(collegeDir)
      .filter((f) => f.endsWith(".json"));

    for (const jsonFile of jsonFiles) {
      const filePath = path.join(collegeDir, jsonFile);
      let sections: CourseSection[];
      try {
        sections = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch {
        continue;
      }
      if (!Array.isArray(sections)) continue;

      for (const section of sections) {
        totalSections++;
        const text = section.prerequisite_text?.trim();
        const courses = section.prerequisite_courses;

        if (!text && (!courses || courses.length === 0)) continue;
        withPrereqs++;

        const prefix = section.course_prefix?.trim();
        const number = section.course_number?.trim();
        if (!prefix || !number) continue;

        // Scrapers sometimes deliver raw markup (",<br>" separators, "<p>"
        // prose) and term-stamp junk in courses[] — clean it here so a
        // cron rebuild can never re-contaminate prereqs.json (PR #973 fixed
        // the data only, and the next scheduled run reverted it).
        const clean = sanitizePrereqEntry(text || "", courses || []);
        mergePrereq(prereqs, `${prefix} ${number}`, clean.text, clean.courses);
      }
    }
  }

  // Also walk coursedog-catalog/*.json — auth-gated section systems (Workday,
  // Ellucian Experience) often have a public Coursedog/Acalog catalog
  // alongside that exposes course-level prereqs. FL/FSCJ and FL/FSW are the
  // first such cases. The catalog scrapers write CoursedogCourse objects
  // (prefix / number / prerequisite_text / prerequisite_courses).
  const catalogDir = path.join(root, "data", state, "coursedog-catalog");
  let catalogCourses = 0;
  let catalogWithPrereqs = 0;
  let catalogColleges = 0;
  if (fs.existsSync(catalogDir)) {
    const catalogFiles = fs
      .readdirSync(catalogDir)
      .filter((f) => f.endsWith(".json"));
    catalogColleges = catalogFiles.length;
    for (const file of catalogFiles) {
      let courses: Array<{
        prefix?: string;
        number?: string;
        prerequisite_text?: string | null;
        prerequisite_courses?: string[] | null;
      }>;
      try {
        courses = JSON.parse(fs.readFileSync(path.join(catalogDir, file), "utf-8"));
      } catch {
        continue;
      }
      if (!Array.isArray(courses)) continue;

      for (const c of courses) {
        catalogCourses++;
        const text = (c.prerequisite_text || "").trim();
        const courseList = c.prerequisite_courses || [];
        if (!text && courseList.length === 0) continue;
        catalogWithPrereqs++;

        const prefix = c.prefix?.trim();
        const number = c.number?.trim();
        if (!prefix || !number) continue;

        const clean = sanitizePrereqEntry(text, courseList);
        mergePrereq(prereqs, `${prefix} ${number}`, clean.text, clean.courses);
      }
    }
  }

  // Backstop for hybrid states: keep entries a dedicated catalog scraper
  // tagged with `source` — aggregation cannot re-derive them from sections.
  const { merged, preserved } = preserveSourcedEntries(prereqs, existing);

  // Write output
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Sort keys for stable output
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) {
    sorted[key] = merged[key];
  }

  // Safety net: refuse to overwrite a healthy prereqs.json with a rebuild
  // that drops below 50% of the existing entry count. Aggregation re-derives
  // prereqs from course-section `prerequisite_text` + coursedog-catalog files.
  // That source can be far thinner than the committed file when:
  //   - a dedicated catalog/Coursedog scraper wrote a richer prereqs.json this
  //     same run but emits per-college catalog files for only some colleges
  //     (NV: 1322 entries from 4 colleges, but only 1 catalog file on disk →
  //     re-aggregation yields 339 and would clobber it), or
  //   - an upstream AWS-WAF challenge gutted the catalog input this tick
  //     (TX/NY May-2026 regressions), or
  //   - sections simply carry no prereq_text (the original ME 0-entry case).
  // 50% mirrors scrape-diff.ts's ABORT_RATIO so the aggregator and the diff
  // agree on what "looks broken" means. Pass --force for genuine resets.
  const newCount = Object.keys(sorted).length;
  if (!opts.force && existingCount > 0 && newCount < existingCount * 0.5) {
    console.error(
      `  REFUSED to overwrite ${outPath}: aggregation produced ${newCount} ` +
        `entries but the existing file has ${existingCount} (< 50%). The ` +
        `dedicated catalog scraper's output or a WAF-degraded catalog likely ` +
        `differs from section-derived aggregation — check ` +
        `StateConfig.scrapers.prereqs and scraper health. ` +
        `Re-run with --force to overwrite anyway.`,
    );
    return existingCount;
  }

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));

  const catalogNote =
    catalogColleges > 0
      ? ` + ${catalogWithPrereqs}/${catalogCourses} catalog courses across ${catalogColleges} Coursedog/Acalog colleges`
      : "";
  const preservedNote =
    preserved > 0 ? `; preserved ${preserved} source-tagged catalog entries` : "";
  console.log(
    `  ${state}: ${newCount} unique courses with prereqs ` +
      `(from ${withPrereqs}/${totalSections} sections across ${colleges.length} colleges${catalogNote}${preservedNote})`,
  );
  console.log(`  → ${outPath}`);

  return newCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes("--force");

  // Derived from the registry: any state whose StateConfig declares
  // `prereqs: { source: "aggregate-from-courses" }`. CLAUDE.md invariant #1
  // — no hardcoded state lists.
  const AGGREGATABLE_STATES = getAllStates()
    .filter((c) => {
      const p = c.scrapers?.prereqs;
      return p && !Array.isArray(p) && p.source === "aggregate-from-courses";
    })
    .map((c) => c.slug);

  let states: string[];

  if (args.includes("--all")) {
    states = AGGREGATABLE_STATES;
  } else if (args.length > 0) {
    states = args.filter((a) => !a.startsWith("-"));
  } else {
    console.log("Usage: npx tsx scripts/lib/aggregate-prereqs.ts <state...> | --all [--force]");
    console.log(`Available states: ${AGGREGATABLE_STATES.join(", ")}`);
    process.exit(1);
  }

  if (states.length === 0) {
    console.log("No states declare `aggregate-from-courses` in their config — nothing to do.");
    process.exit(0);
  }

  console.log(`Aggregating prereqs for: ${states.join(", ")}\n`);

  let totalEntries = 0;
  for (const state of states) {
    totalEntries += aggregateState(state, { force });
  }

  console.log(`\n✓ Done — ${totalEntries} total prereq entries across ${states.length} states`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
