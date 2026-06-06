/**
 * Pre-compute per-course "available this term" availability per state, from the
 * on-disk section files data/{state}/courses/{slug}/{term}.json. Output:
 *   data/{state}/course-availability.json
 *   = Record<"PREFIX-NUMBER", { colleges: string[]; totalSections: number }>
 *
 * Why this exists: /[state]/transfer's "Available Now" tile, its "available this
 * term only" filter, and the per-row availability badge all read this map. But
 * building it at request time (even with the IN-query narrowing in #786) tripped
 * Vercel's ~15s streaming timeout on big states (CA/TX/MI/TN/NJ/MD), so the page
 * shipped with an empty `{}` and the feature silently showed 0 / empty (#777).
 * This is the build-time cache app/[state]/transfer/page.tsx's comment promised —
 * same shape + pattern as scripts/build-transfer-universities-cache.ts.
 *
 * Pure file reads — no Supabase, so it runs anywhere (matching the universities
 * cache). The "current term" is derived the same way lib/terms.ts pickBestTerm
 * does: the term the most colleges have on disk (ties broken toward the later
 * term). Wired into `npm run build`; re-run after any course-data refresh.
 *
 * Usage: npx tsx scripts/build-course-availability-cache.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

interface AvailabilityEntry {
  colleges: string[];
  totalSections: number;
}

interface Section {
  course_prefix?: string;
  course_number?: string;
}

function listStates(): string[] {
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.length === 2)
    .map((d) => d.name)
    .sort();
}

// Chronological order key for a term code (Spring < Summer < Fall within a year),
// so the tie-break picks the genuinely later term — string sort would order
// "2026FA" before "2026SP". Mirrors lib/terms.ts termSortKey.
const SEASON_ORD: Record<string, number> = { SP: 0, SU: 1, FA: 2 };
function termOrd(term: string): number {
  const m = term.match(/^(\d{4})(SP|SU|FA)$/);
  return m ? parseInt(m[1], 10) * 3 + SEASON_ORD[m[2]] : 0;
}

// Current term = the term the most colleges have a file for on disk (ties toward
// the later term). This matches lib/terms.ts pickBestTerm (which picks the term
// with the highest college_count) for the realistic Spring/Summer/Fall data,
// without importing lib/terms.ts (it pulls in the Supabase client).
function currentTerm(coursesDir: string, slugs: string[]): string | null {
  const counts = new Map<string, number>();
  for (const slug of slugs) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(coursesDir, slug));
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith(".json")) {
        const t = f.slice(0, -5);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [t, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && termOrd(t) > termOrd(best))) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

function buildOne(state: string): { written: boolean; courses: number; term: string | null } {
  const coursesDir = path.join(DATA_DIR, state, "courses");
  if (!fs.existsSync(coursesDir)) return { written: false, courses: 0, term: null };

  const slugs = fs
    .readdirSync(coursesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (slugs.length === 0) return { written: false, courses: 0, term: null };

  const term = currentTerm(coursesDir, slugs);
  if (!term) return { written: false, courses: 0, term: null };

  const sectionCounts = new Map<string, number>();
  const collegeSets = new Map<string, Set<string>>();

  for (const slug of slugs) {
    const termFile = path.join(coursesDir, slug, `${term}.json`);
    if (!fs.existsSync(termFile)) continue;
    let sections: Section[];
    try {
      sections = JSON.parse(fs.readFileSync(termFile, "utf8")) as Section[];
    } catch {
      continue;
    }
    if (!Array.isArray(sections)) continue;
    for (const s of sections) {
      if (!s || !s.course_prefix || !s.course_number) continue;
      const key = `${s.course_prefix}-${s.course_number}`;
      sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
      if (!collegeSets.has(key)) collegeSets.set(key, new Set());
      collegeSets.get(key)!.add(slug);
    }
  }

  const out: Record<string, AvailabilityEntry> = {};
  for (const [key, count] of sectionCounts) {
    out[key] = {
      colleges: Array.from(collegeSets.get(key)!).sort(),
      totalSections: count,
    };
  }

  const outPath = path.join(DATA_DIR, state, "course-availability.json");
  fs.writeFileSync(outPath, JSON.stringify(out) + "\n");
  return { written: true, courses: Object.keys(out).length, term };
}

function main() {
  const states = listStates();
  console.log(`Building course-availability cache for ${states.length} states…\n`);
  let withCache = 0;
  let totalCourses = 0;
  for (const s of states) {
    const t0 = Date.now();
    const { written, courses, term } = buildOne(s);
    const ms = Date.now() - t0;
    if (written) {
      withCache++;
      totalCourses += courses;
      console.log(
        `  ${s}: ${courses.toString().padStart(4)} courses  term=${term}  (${ms}ms)`,
      );
    } else {
      console.log(`  ${s}: (no course data)`);
    }
  }
  console.log(
    `\nDone. ${withCache}/${states.length} states cached, ${totalCourses} course entries total.`,
  );
}

main();
