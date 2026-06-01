/**
 * build-section-counts-snapshot.ts
 *
 * Pre-build snapshot of section counts per (state, college, term). Written
 * to data/section-counts.json. `lib/courses.ts::getCourseCount` reads this
 * snapshot first, falling back to Supabase only when the snapshot has no
 * entry for the requested key.
 *
 * Why: `/colleges/page.tsx` calls `getCourseCount` for every college in
 * every registered state (51 states × ~15 colleges = ~765 calls) during
 * static generation. Each call is a Supabase `select("id", { count })`,
 * which on Vercel saturates the free-tier connection pool, blows past the
 * 60s per-page static-gen budget, and fails the build with
 * "Failed to build /colleges/page: /colleges after 3 attempts."
 *
 * The on-disk JSON files are the authoritative source — each
 * `data/{state}/courses/{slug}/{term}.json` is a sections array whose
 * length equals what the Supabase COUNT query returns. So we count once
 * here at build time, write the manifest, and `getCourseCount` becomes a
 * pure in-memory lookup during page generation.
 *
 * Edge case: if a term file is committed but the Supabase import hasn't
 * run yet, the snapshot reports the higher number — that's the correct
 * "courses available for this term" view; the import lag is the bug, not
 * the snapshot.
 *
 * Snapshot shape (compact: stringified key → count):
 *
 *   { "<state>|<collegeSlug>|<term>": <count>, ... }
 *
 * Usage:
 *   npx tsx scripts/build-section-counts-snapshot.ts
 *   npm run build:section-counts-snapshot
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(DATA_DIR, "section-counts.json");

const isStateDir = (name: string): boolean => /^[a-z]{2}$/.test(name);
const isTermFile = (name: string): boolean =>
  /^\d{4}(SP|SU|FA|WI)\.json$/.test(name);

function main(): void {
  const t0 = Date.now();
  const counts: Record<string, number> = {};

  const stateDirs = fs.readdirSync(DATA_DIR).filter((entry) => {
    if (!isStateDir(entry)) return false;
    const coursesDir = path.join(DATA_DIR, entry, "courses");
    return fs.existsSync(coursesDir) && fs.statSync(coursesDir).isDirectory();
  });

  let totalEntries = 0;
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
        try {
          const raw = fs.readFileSync(path.join(collegeDir, file), "utf-8");
          const parsed = JSON.parse(raw) as unknown;
          const count = Array.isArray(parsed) ? parsed.length : 0;
          counts[`${state}|${college}|${term}`] = count;
          totalEntries++;
        } catch {
          // ignore unreadable / unparseable files — snapshot will fall back
        }
      }
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(counts) + "\n");

  console.log(
    `[section-counts-snapshot] ${stateDirs.length} states · ${totalEntries} (state,college,term) entries → ${OUT_PATH} (${Date.now() - t0}ms)`,
  );
}

try {
  main();
} catch (err) {
  console.error("[section-counts-snapshot] Failed:", err);
  if (!fs.existsSync(OUT_PATH)) process.exit(1);
  console.warn("[section-counts-snapshot] Keeping existing snapshot.");
}
