/**
 * build-last-updated-snapshot.ts
 *
 * Pre-build snapshot of last-updated mtimes per (state, college, dataset).
 * Written to data/last-updated.json. `lib/data-freshness.ts` imports this
 * snapshot statically instead of calling `fs.readdirSync` / `fs.statSync`
 * at runtime.
 *
 * Why: the runtime fs lookups in data-freshness.ts use dynamic paths that
 * Next's tracer can't narrow. Even with the `outputFileTracingExcludes`
 * config, Next 16 warns the pattern is "overly broad" and bundles the
 * entire `data/` tree (1.5 GB) into every function that transitively
 * imports the module — blowing past Vercel's 250 MB serverless function
 * cap.
 *
 * Snapshot shape (kept small — only metadata, not data):
 *
 *   {
 *     "courses":   { "<state>": { "<collegeSlug>": "<ISO mtime>" } },
 *     "courses_state": { "<state>": "<ISO mtime>" },   // max across colleges
 *     "programs":  { "<state>": { "<collegeSlug>": "<ISO mtime>" },
 *                    "<state>_state": "<ISO mtime>" }, // max across colleges
 *     "transfers": { "<state>": "<ISO mtime>" }
 *   }
 *
 * Usage:
 *   npx tsx scripts/build-last-updated-snapshot.ts
 *   npm run build:last-updated-snapshot
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(DATA_DIR, "last-updated.json");

interface Snapshot {
  courses: Record<string, Record<string, string>>;
  courses_state: Record<string, string>;
  programs: Record<string, Record<string, string>>;
  programs_state: Record<string, string>;
  transfers: Record<string, string>;
}

const isStateDir = (name: string): boolean => /^[a-z]{2}$/.test(name);

function safeStat(p: string): Date | null {
  try { return fs.statSync(p).mtime; } catch { return null; }
}
function isoOrNull(d: Date | null): string | undefined {
  return d ? d.toISOString() : undefined;
}
function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function main(): void {
  const t0 = Date.now();
  const snap: Snapshot = {
    courses: {},
    courses_state: {},
    programs: {},
    programs_state: {},
    transfers: {},
  };

  const stateDirs = fs.readdirSync(DATA_DIR).filter((entry) => {
    if (!isStateDir(entry)) return false;
    return fs.statSync(path.join(DATA_DIR, entry)).isDirectory();
  });

  for (const state of stateDirs) {
    // Courses: latest mtime per college (across all term files) + state-level max.
    const coursesDir = path.join(DATA_DIR, state, "courses");
    if (fs.existsSync(coursesDir)) {
      const collegeDirs = fs.readdirSync(coursesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      let stateMax: Date | null = null;
      const perCollege: Record<string, string> = {};
      for (const college of collegeDirs) {
        const collegeDir = path.join(coursesDir, college);
        let collegeMax: Date | null = null;
        for (const file of fs.readdirSync(collegeDir).filter((f) => f.endsWith(".json"))) {
          collegeMax = maxDate(collegeMax, safeStat(path.join(collegeDir, file)));
        }
        if (collegeMax) {
          perCollege[college] = collegeMax.toISOString();
          stateMax = maxDate(stateMax, collegeMax);
        }
      }
      if (Object.keys(perCollege).length) snap.courses[state] = perCollege;
      const iso = isoOrNull(stateMax);
      if (iso) snap.courses_state[state] = iso;
    }

    // Programs: mtime per college (each is a single JSON file) + state-level max.
    const programsDir = path.join(DATA_DIR, state, "programs");
    if (fs.existsSync(programsDir)) {
      let stateMax: Date | null = null;
      const perCollege: Record<string, string> = {};
      for (const file of fs.readdirSync(programsDir).filter((f) => f.endsWith(".json"))) {
        const mt = safeStat(path.join(programsDir, file));
        if (mt) {
          perCollege[file.replace(/\.json$/, "")] = mt.toISOString();
          stateMax = maxDate(stateMax, mt);
        }
      }
      if (Object.keys(perCollege).length) snap.programs[state] = perCollege;
      const iso = isoOrNull(stateMax);
      if (iso) snap.programs_state[state] = iso;
    }

    // Transfers: single transfer-equiv.json per state.
    const transferFile = path.join(DATA_DIR, state, "transfer-equiv.json");
    const transferMtime = safeStat(transferFile);
    if (transferMtime) snap.transfers[state] = transferMtime.toISOString();
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(snap, null, 2) + "\n");

  const states = stateDirs.length;
  const courseColleges = Object.values(snap.courses).reduce((acc, v) => acc + Object.keys(v).length, 0);
  const programColleges = Object.values(snap.programs).reduce((acc, v) => acc + Object.keys(v).length, 0);
  console.log(
    `[last-updated-snapshot] ${states} states · ${courseColleges} course colleges · ${programColleges} program colleges · ${Object.keys(snap.transfers).length} transfer files → ${OUT_PATH} (${Date.now() - t0}ms)`,
  );
}

try {
  main();
} catch (err) {
  console.error("[last-updated-snapshot] Failed:", err);
  if (!fs.existsSync(OUT_PATH)) process.exit(1);
  console.warn("[last-updated-snapshot] Keeping existing snapshot.");
}
