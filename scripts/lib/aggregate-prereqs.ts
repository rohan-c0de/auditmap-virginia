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

        const key = `${prefix} ${number}`;
        // Keep the entry with the most prerequisite courses (richest data)
        if (prereqs[key]) {
          const existing = prereqs[key];
          if ((courses?.length || 0) > existing.courses.length) {
            prereqs[key] = {
              text: text || existing.text,
              courses: courses || existing.courses,
            };
          }
        } else {
          prereqs[key] = {
            text: text || "",
            courses: courses || [],
          };
        }
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

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));

  console.log(
    `  ${state}: ${Object.keys(sorted).length} unique courses with prereqs ` +
      `(from ${withPrereqs}/${totalSections} sections across ${colleges.length} colleges)`,
  );
  console.log(`  → ${outPath}`);

  return Object.keys(sorted).length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

// States that have prereq data in their section files
const AGGREGATABLE_STATES = ["va", "nc", "sc", "ga", "dc", "md"];

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

console.log(`Aggregating prereqs for: ${states.join(", ")}\n`);

let totalEntries = 0;
for (const state of states) {
  totalEntries += aggregateState(state);
}

console.log(`\n✓ Done — ${totalEntries} total prereq entries across ${states.length} states`);
