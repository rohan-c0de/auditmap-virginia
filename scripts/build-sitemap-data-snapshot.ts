/**
 * build-sitemap-data-snapshot.ts
 *
 * Pre-build the per-(state, college, term) subject-count rollup that
 * `/sitemap/college-subjects.xml` needs. Written to
 * `data/sitemap-college-subjects.json`.
 *
 * Background: the failing route used to call `loadCoursesForCollege` for
 * every college in every registered state (≈ 675 colleges) during
 * Vercel's static-page generation. Each call fired a Supabase COUNT
 * followed by paginated section fetches, saturating the free-tier
 * connection pool. The build log showed dozens of
 *   "loadCoursesForCollege count error:"
 * lines (no detail because the error object had no `.message`), then
 *   "Failed to build /sitemap/college-subjects.xml/route after 3 attempts."
 *
 * The on-disk JSON files under `data/{state}/courses/{slug}/{term}.json`
 * are the authoritative source (the scrape → import pipeline writes both
 * disk + Supabase from the same payload). Walk them once at build time
 * and aggregate the subject counts we need.
 *
 * Snapshot shape (compact, ~300 KB across all states):
 *
 *   {
 *     "<state>|<collegeSlug>|<term>": [
 *       { "prefix": "ACC", "count": 12 },
 *       ...
 *     ]
 *   }
 *
 * The route's filter `count >= 3` is applied at render time, so the
 * snapshot keeps every prefix (even 1-section ones) — leaves the
 * threshold flexible without forcing a rebuild.
 *
 * Usage:
 *   npx tsx scripts/build-sitemap-data-snapshot.ts
 *   npm run build:sitemap-data-snapshot
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(DATA_DIR, "sitemap-college-subjects.json");

const isStateDir = (name: string): boolean => /^[a-z]{2}$/.test(name);
const isTermFile = (name: string): boolean =>
  /^\d{4}(SP|SU|FA|WI)\.json$/.test(name);

interface SectionRow {
  course_prefix?: string;
}

function main(): void {
  const t0 = Date.now();
  const snap: Record<string, Array<{ prefix: string; count: number }>> = {};

  const stateDirs = fs.readdirSync(DATA_DIR).filter((entry) => {
    if (!isStateDir(entry)) return false;
    const coursesDir = path.join(DATA_DIR, entry, "courses");
    return fs.existsSync(coursesDir) && fs.statSync(coursesDir).isDirectory();
  });

  let entries = 0;
  for (const state of stateDirs) {
    const coursesDir = path.join(DATA_DIR, state, "courses");
    const collegeDirs = fs
      .readdirSync(coursesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const college of collegeDirs) {
      const collegeDir = path.join(coursesDir, college);
      const termFiles = fs.readdirSync(collegeDir).filter(isTermFile);
      for (const file of termFiles) {
        const term = file.replace(/\.json$/, "");

        let rows: SectionRow[];
        try {
          const raw = fs.readFileSync(path.join(collegeDir, file), "utf-8");
          const parsed = JSON.parse(raw) as unknown;
          rows = Array.isArray(parsed) ? (parsed as SectionRow[]) : [];
        } catch {
          continue;
        }

        const prefixCounts = new Map<string, number>();
        for (const r of rows) {
          const prefix = (r.course_prefix || "").trim();
          if (!prefix) continue;
          prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
        }
        if (prefixCounts.size === 0) continue;

        const key = `${state}|${college}|${term}`;
        snap[key] = Array.from(prefixCounts, ([prefix, count]) => ({ prefix, count })).sort(
          (a, b) => a.prefix.localeCompare(b.prefix),
        );
        entries++;
      }
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(snap) + "\n");

  console.log(
    `[sitemap-data-snapshot] ${stateDirs.length} states · ${entries} (state,college,term) entries → ${OUT_PATH} (${Date.now() - t0}ms)`,
  );
}

try {
  main();
} catch (err) {
  console.error("[sitemap-data-snapshot] Failed:", err);
  if (!fs.existsSync(OUT_PATH)) process.exit(1);
  console.warn("[sitemap-data-snapshot] Keeping existing snapshot.");
}
