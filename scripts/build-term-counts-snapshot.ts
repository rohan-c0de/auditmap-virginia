/**
 * build-term-counts-snapshot.ts
 *
 * Pre-build snapshot of (state, term, college_count) for every state/term
 * combination represented in data/{state}/courses/. Written to
 * data/term-counts.json. lib/terms.ts reads this snapshot during static
 * generation instead of calling Supabase per-worker.
 *
 * Why: Next's static gen runs ~3 worker processes in parallel, each its
 * own Node process. The in-memory cache in lib/terms.ts is per-process,
 * so three cold misses fire the same expensive RPC against the 1M+-row
 * courses table at the same time. Combined with stale visibility-map
 * between vacuums, the Index Only Scan falls back to heap fetches and
 * the 2-minute statement_timeout kills the query.
 *
 * The snapshot is derived from the on-disk files directly — no Supabase
 * call. The same data Supabase has came from these JSON files via the
 * scrape → import pipeline, so the count is equivalent. (Edge case: if a
 * scrape file is committed but the Supabase import hasn't run yet, the
 * snapshot reports a higher count than the DB has for that term. That's
 * a correct view of what *should* be the current term — the import lag
 * is the bug, not the snapshot.)
 *
 * Bonus: removes a Supabase dependency from the build entirely, so a DB
 * incident no longer breaks deploys.
 *
 * Usage:
 *   npx tsx scripts/build-term-counts-snapshot.ts
 *   npm run build:term-counts-snapshot
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(DATA_DIR, "term-counts.json");

interface TermCountRow {
  state: string;
  term: string;
  college_count: number;
}

function isTermFile(name: string): boolean {
  // e.g. 2026FA.json, 2026SP.json, 2026SU.json
  return /^\d{4}(SP|SU|FA)\.json$/.test(name);
}

function isStateDir(name: string): boolean {
  // 2-letter slug, lowercase
  return /^[a-z]{2}$/.test(name);
}

function main(): void {
  const t0 = Date.now();
  // Track (state, term) -> Set<college_slug>
  const collegesByStateTerm = new Map<string, Set<string>>();

  const stateDirs = fs.readdirSync(DATA_DIR).filter((entry) => {
    if (!isStateDir(entry)) return false;
    const coursesDir = path.join(DATA_DIR, entry, "courses");
    return fs.existsSync(coursesDir) && fs.statSync(coursesDir).isDirectory();
  });

  for (const state of stateDirs) {
    const coursesDir = path.join(DATA_DIR, state, "courses");
    const collegeDirs = fs.readdirSync(coursesDir).filter((c) =>
      fs.statSync(path.join(coursesDir, c)).isDirectory(),
    );

    for (const college of collegeDirs) {
      const collegeDir = path.join(coursesDir, college);
      const termFiles = fs.readdirSync(collegeDir).filter(isTermFile);

      for (const file of termFiles) {
        const term = file.replace(/\.json$/, "");
        // Only count the college if its term file actually has data; an
        // empty array indicates a scrape ran but found nothing this term.
        try {
          const stats = fs.statSync(path.join(collegeDir, file));
          if (stats.size < 5) continue; // "[]\n" is 3 bytes; anything < 5 is empty
        } catch {
          continue;
        }
        const key = `${state}|${term}`;
        if (!collegesByStateTerm.has(key)) collegesByStateTerm.set(key, new Set());
        collegesByStateTerm.get(key)!.add(college);
      }
    }
  }

  const rows: TermCountRow[] = [];
  for (const [key, colleges] of collegesByStateTerm) {
    const [state, term] = key.split("|");
    rows.push({ state, term, college_count: colleges.size });
  }
  rows.sort((a, b) => a.state.localeCompare(b.state) || a.term.localeCompare(b.term));

  fs.writeFileSync(OUT_PATH, JSON.stringify(rows, null, 2) + "\n");

  const states = new Set(rows.map((r) => r.state)).size;
  console.log(
    `[term-counts-snapshot] Wrote ${rows.length} rows (${states} states) to ${OUT_PATH} in ${Date.now() - t0}ms.`,
  );
}

try {
  main();
} catch (err) {
  console.error("[term-counts-snapshot] Failed:", err);
  // Don't fail the build if a previous snapshot exists.
  if (!fs.existsSync(OUT_PATH)) process.exit(1);
  console.warn("[term-counts-snapshot] Keeping existing snapshot.");
}
