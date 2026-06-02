/**
 * One-time migration: canonicalize SD course term filenames.
 *
 * The importer (scripts/lib/supabase-import.ts) derives the Supabase `term`
 * key straight from the filename (`file.replace(".json","")`). SD has two
 * colleges whose course files use label-format names from an older scraper:
 *
 *   data/sd/courses/oglala-lakota-college/fall-2026.json     (term "fall-2026")
 *   data/sd/courses/southeast-technical-college/fall-2026.json   (stale dupe)
 *
 * So those rows imported into Supabase under term "fall-2026" / "summer-2026",
 * which getCurrentTerm() and course search never query (they use canonical
 * "2026FA" / "2026SU"). oglala's ~374 sections are therefore invisible on prod.
 * southeast-technical-college ALSO has canonical files now (2026FA.json from a
 * later scheduled scrape), so its label files are just stale duplicates.
 *
 * This script, for each `{season}-{year}.json` file:
 *   - computes the canonical code ({year}{FA|SP|SU|WI})
 *   - if a canonical file already exists -> delete the label file (dupe)
 *   - else -> rewrite rows with term set to the canonical code and save as
 *     {code}.json, then delete the label file
 *
 * Idempotent and SD-scoped. The current SD scrapers already emit canonical
 * filenames (scrape-southeast-tech.ts / scrape-oglala-lakota.ts write
 * `${code}.json`), so no scraper change is needed — this only cleans up
 * already-committed data from the older format.
 *
 * Usage:  npx tsx scripts/sd/normalize-term-filenames.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const COURSES_ROOT = join(process.cwd(), "data", "sd", "courses");
const SEASON_CODE: Record<string, string> = {
  fall: "FA",
  spring: "SP",
  summer: "SU",
  winter: "WI",
};

/** "fall-2026" -> "2026FA", or null if not season-year format. */
function toCanonical(stem: string): string | null {
  const m = stem.toLowerCase().match(/^(fall|spring|summer|winter)-(\d{4})$/);
  if (!m) return null;
  return `${m[2]}${SEASON_CODE[m[1]]}`;
}

function main() {
  let renamed = 0;
  let deletedDupes = 0;
  let rowsRetermed = 0;

  for (const college of readdirSync(COURSES_ROOT)) {
    const dir = join(COURSES_ROOT, college);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const stem = file.replace(/\.json$/, "");
      const canonical = toCanonical(stem);
      if (!canonical) continue; // already canonical or unknown — leave it

      const labelPath = join(dir, file);
      const canonicalPath = join(dir, `${canonical}.json`);

      if (existsSync(canonicalPath)) {
        // Canonical version already present (newer scrape) — the label file is
        // a stale duplicate. Remove it so it stops importing junk terms.
        rmSync(labelPath);
        deletedDupes++;
        console.log(`  dupe   ${college}/${file} -> already have ${canonical}.json, deleted`);
      } else {
        // Promote the label file to canonical: fix every row's term, write the
        // canonical filename, drop the old one.
        const rows = JSON.parse(readFileSync(labelPath, "utf8")) as Array<{ term?: string }>;
        for (const r of rows) {
          if (r.term !== canonical) {
            r.term = canonical;
            rowsRetermed++;
          }
        }
        writeFileSync(canonicalPath, JSON.stringify(rows, null, 2) + "\n");
        rmSync(labelPath);
        renamed++;
        console.log(`  rename ${college}/${file} -> ${canonical}.json (${rows.length} rows)`);
      }
    }
  }

  console.log("");
  console.log(`SD term-filename normalization`);
  console.log(`  files renamed to canonical: ${renamed}`);
  console.log(`  stale duplicate files deleted: ${deletedDupes}`);
  console.log(`  row term fields rewritten: ${rowsRetermed}`);

  // Verify nothing label-format remains.
  let remaining = 0;
  for (const college of readdirSync(COURSES_ROOT)) {
    const dir = join(COURSES_ROOT, college);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json") && toCanonical(file.replace(/\.json$/, ""))) remaining++;
    }
  }
  if (remaining > 0) {
    console.error(`\nFAIL — ${remaining} label-format files remain.`);
    process.exit(1);
  }
  console.log(`\nOK — all SD course files use canonical term codes.`);
}

main();

export {};
