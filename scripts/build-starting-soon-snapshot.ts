/**
 * build-starting-soon-snapshot.ts
 *
 * Pre-build a per-state aggregate of sections starting in the next 14 days.
 * Written to `data/starting-soon.json`.
 *
 * Why: `<StartingSoonCallout state={state}>` renders inside every state
 * landing page (app/[state]/page.tsx) and previously called
 * `loadAllCourses(currentTerm, state)` — a paginated Supabase fetch of the
 * full state course catalog. For 51 states during Vercel static
 * generation that's tens of thousands of Supabase rows downloaded inside
 * the 60s per-page budget. Combined with the free-tier pool, /va and
 * /ca repeatedly tripped "took more than 60 seconds" and failed the
 * build after 3 attempts.
 *
 * The component only displays two integers (uniqueCourses,
 * uniqueColleges). We compute both per-state at build time from the
 * on-disk JSON files, write a tiny snapshot, and the component becomes a
 * static-import lookup with no Supabase calls.
 *
 * Shape:
 *
 *   {
 *     "_generatedAt": "2026-06-01T...",   // for debug + cache busting
 *     "windowDays": 14,
 *     "perState": {
 *       "<state>": { "uniqueCourses": N, "uniqueColleges": M }
 *     }
 *   }
 *
 * Usage:
 *   npx tsx scripts/build-starting-soon-snapshot.ts
 *   npm run build:starting-soon-snapshot
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(DATA_DIR, "starting-soon.json");
const WINDOW_DAYS = 14;

const isStateDir = (name: string): boolean => /^[a-z]{2}$/.test(name);
const isTermFile = (name: string): boolean =>
  /^\d{4}(SP|SU|FA|WI)\.json$/.test(name);

interface SectionRow {
  course_prefix?: string;
  course_number?: string;
  college_code?: string;
  start_date?: string;
}

function daysUntilStart(rawDate: string, now: Date): number | null {
  if (!rawDate) return null;
  // Mirror the live `daysUntilStart` helper (lib/course-status.ts):
  // tolerate both ISO ("2026-08-25") and US ("8/25/2026") shapes.
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    d = new Date(rawDate + "T00:00:00Z");
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
    const [m, day, y] = rawDate.split("/").map(Number);
    d = new Date(Date.UTC(y, m - 1, day));
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function main(): void {
  const t0 = Date.now();
  const now = new Date();
  const perState: Record<string, { uniqueCourses: number; uniqueColleges: number }> = {};

  const stateDirs = fs.readdirSync(DATA_DIR).filter((entry) => {
    if (!isStateDir(entry)) return false;
    const coursesDir = path.join(DATA_DIR, entry, "courses");
    return fs.existsSync(coursesDir) && fs.statSync(coursesDir).isDirectory();
  });

  for (const state of stateDirs) {
    const coursesDir = path.join(DATA_DIR, state, "courses");
    const collegeDirs = fs
      .readdirSync(coursesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const courseKeys = new Set<string>();
    const collegeKeys = new Set<string>();

    for (const college of collegeDirs) {
      const collegeDir = path.join(coursesDir, college);
      const termFiles = fs.readdirSync(collegeDir).filter(isTermFile);
      for (const file of termFiles) {
        let rows: SectionRow[];
        try {
          const raw = fs.readFileSync(path.join(collegeDir, file), "utf-8");
          const parsed = JSON.parse(raw) as unknown;
          rows = Array.isArray(parsed) ? (parsed as SectionRow[]) : [];
        } catch {
          continue;
        }
        for (const r of rows) {
          const days = r.start_date ? daysUntilStart(r.start_date, now) : null;
          if (days === null) continue;
          if (days < 0 || days > WINDOW_DAYS) continue;
          const prefix = (r.course_prefix || "").trim();
          const num = (r.course_number || "").trim();
          if (!prefix || !num) continue;
          courseKeys.add(`${prefix}-${num}`);
          if (r.college_code) collegeKeys.add(r.college_code);
        }
      }
    }

    if (courseKeys.size > 0) {
      perState[state] = {
        uniqueCourses: courseKeys.size,
        uniqueColleges: collegeKeys.size,
      };
    }
  }

  const out = {
    _generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    perState,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out) + "\n");

  console.log(
    `[starting-soon-snapshot] ${stateDirs.length} states · ${Object.keys(perState).length} states with upcoming sections → ${OUT_PATH} (${Date.now() - t0}ms)`,
  );
}

try {
  main();
} catch (err) {
  console.error("[starting-soon-snapshot] Failed:", err);
  if (!fs.existsSync(OUT_PATH)) process.exit(1);
  console.warn("[starting-soon-snapshot] Keeping existing snapshot.");
}
