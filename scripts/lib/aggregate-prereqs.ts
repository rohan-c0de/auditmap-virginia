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
 * For states where the main scraper does NOT populate prerequisite data
 * (e.g., DE, TN), use the dedicated catalog fallback scrapers instead.
 *
 * Usage:
 *   npx tsx scripts/lib/aggregate-prereqs.ts va
 *   npx tsx scripts/lib/aggregate-prereqs.ts nc sc ga dc
 *   npx tsx scripts/lib/aggregate-prereqs.ts --all
 */

import * as fs from "fs";
import * as path from "path";
import { getAllStates } from "../../lib/states/registry";

interface CourseSection {
  course_prefix: string;
  course_number: string;
  prerequisite_text?: string;
  prerequisite_courses?: string[];
}

interface PrereqEntry {
  text: string;
  courses: string[];
}

function mergePrereq(
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

function aggregateState(state: string): number {
  const dataDir = path.join(process.cwd(), "data", state, "courses");
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

        mergePrereq(prereqs, `${prefix} ${number}`, text || "", courses || []);
      }
    }
  }

  // Also walk coursedog-catalog/*.json — auth-gated section systems (Workday,
  // Ellucian Experience) often have a public Coursedog/Acalog catalog
  // alongside that exposes course-level prereqs. FL/FSCJ and FL/FSW are the
  // first such cases. The catalog scrapers write CoursedogCourse objects
  // (prefix / number / prerequisite_text / prerequisite_courses).
  const catalogDir = path.join(process.cwd(), "data", state, "coursedog-catalog");
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

        mergePrereq(prereqs, `${prefix} ${number}`, text, courseList);
      }
    }
  }

  // Write output
  const outDir = path.join(process.cwd(), "data", state);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");

  // Sort keys for stable output
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(prereqs).sort()) {
    sorted[key] = prereqs[key];
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
  if (fs.existsSync(outPath) && !process.argv.includes("--force")) {
    let existingCount = 0;
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      existingCount = existing && typeof existing === "object" ? Object.keys(existing).length : 0;
    } catch { /* unreadable — treat as empty */ }
    if (existingCount > 0 && newCount < existingCount * 0.5) {
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
  }

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));

  const catalogNote =
    catalogColleges > 0
      ? ` + ${catalogWithPrereqs}/${catalogCourses} catalog courses across ${catalogColleges} Coursedog/Acalog colleges`
      : "";
  console.log(
    `  ${state}: ${Object.keys(sorted).length} unique courses with prereqs ` +
      `(from ${withPrereqs}/${totalSections} sections across ${colleges.length} colleges${catalogNote})`,
  );
  console.log(`  → ${outPath}`);

  return Object.keys(sorted).length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

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
  console.log("Usage: npx tsx scripts/lib/aggregate-prereqs.ts <state...> | --all");
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
  totalEntries += aggregateState(state);
}

console.log(`\n✓ Done — ${totalEntries} total prereq entries across ${states.length} states`);
