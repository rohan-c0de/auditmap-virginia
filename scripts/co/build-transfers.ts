/**
 * build-transfers.ts
 *
 * Orchestrates the Colorado transfer scrapers and writes the two data files
 * the site reads:
 *   - data/co/transfer-universities.json  ({slug, name}[])
 *   - data/co/transfer-equiv.json         (TransferRow[])
 *
 * Dedup key is (cc_course, university, univ_course): Colorado's statewide CCNS
 * means a CC course code is shared system-wide, so equivalencies are keyed by
 * CC course code, not per community college.
 *
 * If a source fails entirely, its rows are simply absent — we never substitute
 * placeholders (architectural invariant #4). The summary prints exactly what
 * landed.
 *
 * Run: `tsx scripts/co/build-transfers.ts`
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scrapeDu, type TransferRow } from "./scrape-du-transfer";

// NOTE: UCCS was removed as a transfer-equivalency source on 2026-05-31. UCCS's
// public "Best Choices Guide" PDFs (transfer.uccs.edu/course-advising/transfer-
// guides) are degree-plan advising sheets, not course-to-course equivalency
// tables. Lower-division rows list CCCS courses to take at the community college
// (in CCCS dual-number form, e.g. "ENG 121/1021"); upper-division rows list
// UCCS-only courses to take after transfer (e.g. "ANTH 3970", "MGMT 3300").
// The PDFs print NO distinct UCCS receiving code for any CCCS course, so there
// is no valid {cc_course -> univ_course} pair to extract. The previous scraper
// emitted same-code self-maps (CCCS "ACC 1021" -> univ "ACC 1021"), which were
// wrong and misleading, so it was deleted. DU (Banner articulation) remains the
// only real CO course-to-course source.

const DATA_DIR = join(process.cwd(), "data", "co");
const EQUIV_PATH = join(DATA_DIR, "transfer-equiv.json");
const UNIV_PATH = join(DATA_DIR, "transfer-universities.json");

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const all: TransferRow[] = [];

  console.log("Scraping University of Denver (Banner)...");
  try {
    const du = await scrapeDu();
    console.log(`  DU: ${du.length} rows`);
    all.push(...du);
  } catch (e) {
    console.error(`  DU scrape FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Global dedup by (cc_course, university, univ_course).
  const seen = new Set<string>();
  const deduped: TransferRow[] = [];
  for (const r of all) {
    const key = `${r.cc_course}||${r.university}||${r.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  // Stable sort: by cc_prefix, cc_number, university.
  deduped.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number, undefined, { numeric: true }) ||
      a.university.localeCompare(b.university) ||
      a.univ_course.localeCompare(b.univ_course)
  );

  // Build the universities list from whatever receivers actually have rows.
  const univMap = new Map<string, string>();
  for (const r of deduped) univMap.set(r.university, r.university_name);
  const universities = [...univMap.entries()]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  writeFileSync(EQUIV_PATH, JSON.stringify(deduped, null, 2) + "\n");
  writeFileSync(UNIV_PATH, JSON.stringify(universities, null, 2) + "\n");

  // Summary.
  const perUniv = new Map<string, number>();
  for (const r of deduped) perUniv.set(r.university, (perUniv.get(r.university) || 0) + 1);

  console.log("\n=== SUMMARY ===");
  for (const { slug, name } of universities) {
    console.log(`  ${slug} (${name}): ${perUniv.get(slug) || 0} rows`);
  }
  console.log(`  TOTAL rows: ${deduped.length}`);
  console.log(`  Universities: ${universities.length}`);
  console.log(`  Wrote: ${EQUIV_PATH}`);
  console.log(`  Wrote: ${UNIV_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
