/**
 * Data integrity check.
 *
 * Pre-merge guard against silent data corruption that the import-time
 * validators in scripts/lib/supabase-import.ts (schema + change-detection)
 * can't catch.
 *
 * Errors (fail CI):
 *   - A course JSON file under data/{state}/courses/** fails to parse,
 *     or its contents aren't an array. Nothing else in CI today catches
 *     a corrupt or truncated catalog file before merge.
 *
 * Warnings (informational, don't fail CI):
 *   - Duplicate CRNs within (state, college, term). CRNs are unique by
 *     definition, so duplicates signal a scraper double-counting bug.
 *     Today this is warn-only because ~880 pre-existing dupes exist
 *     across MD/SC/VA/ME — promote to error in a follow-up once the
 *     underlying scrapers are deduplicated.
 *   - Prereq entries / references whose course key is absent from the
 *     state's scraped catalog. Often legitimate (developmental courses,
 *     historical course numbers, courses not offered this term).
 *   - Transfer mappings whose CC course is absent from the catalog —
 *     transfer tables intentionally cover historical and cross-system
 *     course numbers, so this is a stat, not a gate.
 *
 * Usage:
 *   npm run check:data
 *   npm run check:data -- --state va        # scope to one state
 *   npm run check:data -- --verbose          # show example rows per category
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getAllStates } from "../lib/states/registry";

// ---------------------------------------------------------------------------
// Types — narrow shapes loaded from disk (full schemas live in lib/schemas.ts)
// ---------------------------------------------------------------------------

interface SectionRow {
  course_prefix: string;
  course_number: string;
  crn: string;
}

interface PrereqEntry {
  text: string;
  courses: string[];
}

type PrereqMap = Record<string, PrereqEntry>;

interface TransferRow {
  cc_prefix: string;
  cc_number: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/** Build the set of "PREFIX NUMBER" keys present in a state's catalog. */
export function buildCourseSet(sections: SectionRow[]): Set<string> {
  const set = new Set<string>();
  for (const s of sections) {
    if (!s.course_prefix || !s.course_number) continue;
    set.add(`${s.course_prefix} ${s.course_number}`);
  }
  return set;
}

/** Find CRN values that appear more than once in the same (college, term). */
export function findDuplicateCrns(
  sections: SectionRow[]
): Array<{ crn: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of sections) {
    if (!s.crn) continue;
    counts.set(s.crn, (counts.get(s.crn) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([crn, count]) => ({ crn, count }));
}

/**
 * Find prereq map entries that reference courses not in the catalog. Returns
 * keys whose entire prereq references are orphans, plus a flat list of every
 * orphan reference so callers can report counts.
 */
export function findOrphanPrereqs(
  prereqs: PrereqMap,
  courseSet: Set<string>
): {
  orphanKeys: string[];
  orphanRefs: Array<{ from: string; to: string }>;
} {
  const orphanKeys: string[] = [];
  const orphanRefs: Array<{ from: string; to: string }> = [];

  for (const [key, entry] of Object.entries(prereqs)) {
    if (!courseSet.has(key)) {
      orphanKeys.push(key);
    }
    for (const ref of entry.courses) {
      if (!courseSet.has(ref)) {
        orphanRefs.push({ from: key, to: ref });
      }
    }
  }

  return { orphanKeys, orphanRefs };
}

/** Transfer rows whose CC course doesn't exist in the state's catalog. */
export function findOrphanTransferMappings(
  transfers: TransferRow[],
  courseSet: Set<string>
): TransferRow[] {
  const orphans: TransferRow[] = [];
  for (const t of transfers) {
    if (!t.cc_prefix || !t.cc_number) continue;
    const key = `${t.cc_prefix} ${t.cc_number}`;
    if (!courseSet.has(key)) orphans.push(t);
  }
  return orphans;
}

// ---------------------------------------------------------------------------
// Filesystem walking
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "..");

function readJsonOrNull<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Read every courses/{college}/{term}.json file for a state. */
function loadAllSections(state: string): SectionRow[] {
  const coursesDir = resolve(ROOT, `data/${state}/courses`);
  if (!existsSync(coursesDir)) return [];
  const all: SectionRow[] = [];

  for (const college of readdirSync(coursesDir)) {
    const collegeDir = join(coursesDir, college);
    if (!statSync(collegeDir).isDirectory()) continue;
    for (const file of readdirSync(collegeDir)) {
      if (!file.endsWith(".json")) continue;
      const rows = readJsonOrNull<SectionRow[]>(join(collegeDir, file));
      if (Array.isArray(rows)) all.push(...rows);
    }
  }
  return all;
}

/** Same, but partition by (college, term) — needed for duplicate-CRN scoping. */
function loadSectionsByGroup(state: string): Map<string, SectionRow[]> {
  const coursesDir = resolve(ROOT, `data/${state}/courses`);
  const groups = new Map<string, SectionRow[]>();
  if (!existsSync(coursesDir)) return groups;

  for (const college of readdirSync(coursesDir)) {
    const collegeDir = join(coursesDir, college);
    if (!statSync(collegeDir).isDirectory()) continue;
    for (const file of readdirSync(collegeDir)) {
      if (!file.endsWith(".json")) continue;
      const rows = readJsonOrNull<SectionRow[]>(join(collegeDir, file));
      if (!Array.isArray(rows)) continue;
      groups.set(`${college}/${file.replace(/\.json$/, "")}`, rows);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

interface Finding {
  level: "error" | "warn";
  state: string;
  category: string;
  detail: string;
}

function checkState(state: string, verbose: boolean): Finding[] {
  const findings: Finding[] = [];
  const coursesDir = resolve(ROOT, `data/${state}/courses`);

  // 1. ERROR: every courses/**/*.json file must parse and be an array.
  if (existsSync(coursesDir)) {
    for (const college of readdirSync(coursesDir)) {
      const collegeDir = join(coursesDir, college);
      if (!statSync(collegeDir).isDirectory()) continue;
      for (const file of readdirSync(collegeDir)) {
        if (!file.endsWith(".json")) continue;
        const fullPath = join(collegeDir, file);
        try {
          const parsed = JSON.parse(readFileSync(fullPath, "utf8"));
          if (!Array.isArray(parsed)) {
            findings.push({
              level: "error",
              state,
              category: "malformed-course-file",
              detail: `data/${state}/courses/${college}/${file} is not an array`,
            });
          }
        } catch (e) {
          findings.push({
            level: "error",
            state,
            category: "malformed-course-file",
            detail: `data/${state}/courses/${college}/${file} failed to parse: ${(e as Error).message}`,
          });
        }
      }
    }
  }

  const allSections = loadAllSections(state);
  const courseSet = buildCourseSet(allSections);

  // 2. WARN: duplicate CRNs within (college, term). Eventually error-level
  //    once the existing scraper dupes in MD/SC/VA/ME are cleaned up.
  for (const [group, rows] of loadSectionsByGroup(state)) {
    const dups = findDuplicateCrns(rows);
    if (dups.length > 0) {
      const sample =
        verbose
          ? ` (e.g. ${dups.slice(0, 3).map((d) => `${d.crn}×${d.count}`).join(", ")})`
          : "";
      findings.push({
        level: "warn",
        state,
        category: "duplicate-crn",
        detail: `${group}: ${dups.length} duplicate CRN(s)${sample}`,
      });
    }
  }

  // 2. Prereq map — orphan keys + refs (informational).
  const prereqs = readJsonOrNull<PrereqMap>(
    resolve(ROOT, `data/${state}/prereqs.json`)
  );
  if (prereqs && courseSet.size > 0) {
    const { orphanKeys, orphanRefs } = findOrphanPrereqs(prereqs, courseSet);
    if (orphanKeys.length > 0) {
      const sample =
        verbose && orphanKeys.length > 0
          ? ` (e.g. ${orphanKeys.slice(0, 3).join(", ")})`
          : "";
      findings.push({
        level: "warn",
        state,
        category: "orphan-prereq-keys",
        detail: `${orphanKeys.length} prereq entries for courses not in this term's catalog${sample}`,
      });
    }
    if (orphanRefs.length > 0) {
      const sample =
        verbose && orphanRefs.length > 0
          ? ` (e.g. ${orphanRefs.slice(0, 3).map((r) => `${r.from}→${r.to}`).join(", ")})`
          : "";
      findings.push({
        level: "warn",
        state,
        category: "orphan-prereq-refs",
        detail: `${orphanRefs.length} prereq references to courses not in this term's catalog${sample}`,
      });
    }
  }

  // 3. Transfer mappings — CC side absent from catalog (informational).
  const transfers = readJsonOrNull<TransferRow[]>(
    resolve(ROOT, `data/${state}/transfer-equiv.json`)
  );
  if (Array.isArray(transfers) && courseSet.size > 0) {
    const orphans = findOrphanTransferMappings(transfers, courseSet);
    if (orphans.length > 0) {
      const sample =
        verbose && orphans.length > 0
          ? ` (e.g. ${orphans.slice(0, 3).map((t) => `${t.cc_prefix} ${t.cc_number}`).join(", ")})`
          : "";
      findings.push({
        level: "warn",
        state,
        category: "orphan-transfer-mappings",
        detail: `${orphans.length} transfer mappings reference CC courses not in the catalog${sample}`,
      });
    }
  }

  return findings;
}

function main(): void {
  const args = process.argv.slice(2);
  const stateIdx = args.indexOf("--state");
  const targetState = stateIdx >= 0 ? args[stateIdx + 1] : null;
  const verbose = args.includes("--verbose");

  const states = targetState
    ? getAllStates().filter((s) => s.slug === targetState)
    : getAllStates();

  if (states.length === 0) {
    console.error(`Unknown state: ${targetState}`);
    process.exit(2);
  }

  const all: Finding[] = [];
  for (const { slug } of states) {
    all.push(...checkState(slug, verbose));
  }

  const errors = all.filter((f) => f.level === "error");
  const warnings = all.filter((f) => f.level === "warn");

  if (errors.length > 0) {
    console.error(`\nErrors (${errors.length}):`);
    for (const f of errors) console.error(`  [${f.state}] ${f.category}: ${f.detail}`);
  }

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const f of warnings) console.log(`  [${f.state}] ${f.category}: ${f.detail}`);
    if (!verbose) console.log(`\n  (run with --verbose to see example rows)`);
  }

  console.log(
    `\nData integrity scan: ${states.length} state(s), ${errors.length} error(s), ${warnings.length} warning(s).`
  );

  if (errors.length > 0) process.exit(1);
}

if (process.argv[1]?.includes("check-data-integrity")) {
  main();
}
