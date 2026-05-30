/**
 * scrape-programs.ts — degree/program requirements for AZ.
 *
 * Seeded from scripts/lib/discover-programs.ts (Phase 6) and then hand-
 * verified — the discoverer's domain-fallback heuristic produced 5
 * cross-state false positives (e.g. catalog.south.edu = South College
 * Tennessee, not South Mountain CC in AZ). Only catalogs whose body
 * actually identifies the AZ college are wired here.
 *
 * Verified (2026-05-24):
 *   cochise-county-community-college-district → catalog.cochise.edu (coursedog)
 *   mohave-community-college                  → catalog.mohave.edu  (acalog)
 *   pima-community-college                    → catalog.pima.edu    (acalog)
 *   coconino-community-college                → catalog.coconino.edu (acalog)
 *
 * Dropped (false-positive cross-state catalogs):
 *   rio-salado-college               → catalog.rio.edu      = University of Rio Grande (OH)
 *   arizona-western-college          → catalog.arizona.edu  = University of Arizona
 *   eastern-arizona-college          → catalog.eastern.edu  = Eastern University (PA)
 *   northland-pioneer-college        → catalog.northland.edu = Northland College (WI)
 *   south-mountain-community-college → catalog.south.edu    = South College (TN)
 *
 * Usage:
 *   npx tsx scripts/az/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";

async function run(
  slug: string,
  scrape: () => Promise<{ programs: unknown[]; catalog_year: string; catalog_url: string; college_slug: string; scraped_at: string }>,
): Promise<void> {
  console.log(`\n=== ${slug} ===`);
  try {
    const data = await scrape();
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug}.`);
      return;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs as never);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", "az", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("AZ program scraper");

  // cochise-county-community-college-district (coursedog)
  await run("cochise-county-community-college-district", () =>
    scrapeCoursedogPrograms({
      collegeSlug: "cochise-county-community-college-district",
      catalogDomain: "catalog.cochise.edu",
      catalogYear: "2025-2026",
    }),
  );

  // mohave-community-college (acalog) — operator must fill catoidFallback
  // and programNavoids after first run (auto-discovery often finds 0 navoids).
  await run("mohave-community-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "mohave-community-college",
      baseUrl: "https://catalog.mohave.edu",
      catoidFallback: 0,
      programNavoids: [],
      autoDiscoverCatoid: true,
    }),
  );

  // pima-community-college (acalog)
  await run("pima-community-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "pima-community-college",
      baseUrl: "https://catalog.pima.edu",
      catoidFallback: 0,
      programNavoids: [],
      autoDiscoverCatoid: true,
    }),
  );

  // coconino-community-college (acalog)
  await run("coconino-community-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "coconino-community-college",
      baseUrl: "https://catalog.coconino.edu",
      catoidFallback: 0,
      programNavoids: [],
      autoDiscoverCatoid: true,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
