/**
 * scrape-programs.ts — degree/program requirements for South Carolina.
 *
 * SC Technical College System catalogs span three platforms:
 *   • Acalog (8): central-carolina, spartanburg, trident, york (original 4)
 *     + florence-darlington, lowcountry, northeastern, tri-county (added
 *     2026-06). Every SC Acalog catalog now sits behind AWS WAF — content.php
 *     returns HTTP 202 + an empty body on plain fetch — so ALL of them use
 *     `usePlaywright` to solve the JS challenge. (Before this, a plain-fetch
 *     re-run would have silently zeroed the original 4 colleges' data.)
 *   • CourseLeaf (1): piedmont (programs under /academic-programs/).
 *   • CleanCatalog (1): orangeburg-calhoun (default /degrees index).
 *
 * Deferred (no templated public catalog — see data/sc/DEFERRED-programs.md):
 *   aiken, denmark, greenville, horry-georgetown, midlands, williamsburg.
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CollegePrograms } from "../../lib/types.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const CATALOG_YEAR = "2025-2026";

// All SC Acalog catalogs are AWS-WAF-gated → usePlaywright on every entry.
// The original 4 keep their probed catoid/navoid; the 4 added in 2026-06 use
// catoid auto-discovery + search_advanced.php fallback (their navoids weren't
// individually probed, and search discovery is reliable through Playwright).
const ACALOG: AcalogProgramConfig[] = [
  {
    collegeSlug: "central-carolina",
    baseUrl: "https://catalog.cctech.edu",
    catoidFallback: 14,
    programNavoids: [1331],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "spartanburg",
    baseUrl: "https://catalog.sccsc.edu",
    catoidFallback: 29,
    programNavoids: [2329],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "trident",
    baseUrl: "https://catalog.tridenttech.edu",
    catoidFallback: 6,
    programNavoids: [432],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "york",
    baseUrl: "https://catalog.yorktech.edu",
    catoidFallback: 11,
    programNavoids: [289],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "florence-darlington",
    baseUrl: "https://catalog.fdtc.edu",
    catoidFallback: 0,
    programNavoids: [],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "lowcountry",
    baseUrl: "https://catalog.tcl.edu",
    catoidFallback: 0,
    programNavoids: [],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "northeastern",
    baseUrl: "https://catalog.netc.edu",
    catoidFallback: 0,
    programNavoids: [],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
  {
    collegeSlug: "tri-county",
    baseUrl: "https://catalog.tctc.edu",
    catoidFallback: 0,
    programNavoids: [],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true,
  },
];

async function persist(outDir: string, data: CollegePrograms): Promise<number> {
  if (data.programs.length === 0) {
    console.log(`  No programs found for ${data.college_slug}, skipping.`);
    return 0;
  }
  const { matched, unmatched } = applyProgramMatching(data.programs);
  console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
  const outPath = path.join(outDir, `${data.college_slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
  return data.programs.length;
}

async function main() {
  const outDir = path.join(process.cwd(), "data", "sc", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  let total = 0;

  for (const config of ACALOG) {
    console.log(`\n${"=".repeat(60)}\nScraping ${config.collegeSlug} (${config.baseUrl}) [acalog]\n${"=".repeat(60)}`);
    try {
      total += await persist(outDir, await scrapeAcalogPrograms(config));
    } catch (e) {
      console.error(`  ERROR scraping ${config.collegeSlug}: ${e}`);
    }
  }

  // piedmont — CourseLeaf, programs under /academic-programs/ (not the
  // template default /programs-study/).
  console.log(`\n${"=".repeat(60)}\nScraping piedmont (catalog.ptc.edu) [courseleaf]\n${"=".repeat(60)}`);
  try {
    total += await persist(
      outDir,
      await scrapeCourseleafPrograms({
        collegeSlug: "piedmont",
        baseUrl: "https://catalog.ptc.edu",
        programIndexPath: "/academic-programs/",
      }),
    );
  } catch (e) {
    console.error(`  ERROR scraping piedmont: ${e}`);
  }

  // orangeburg-calhoun — CleanCatalog, default /degrees index.
  console.log(`\n${"=".repeat(60)}\nScraping orangeburg-calhoun (catalog.octech.edu) [cleancatalog]\n${"=".repeat(60)}`);
  try {
    total += await persist(
      outDir,
      await scrapeCleanCatalogPrograms({
        collegeSlug: "orangeburg-calhoun",
        baseUrl: "https://catalog.octech.edu",
        catalogYear: CATALOG_YEAR,
      }),
    );
  } catch (e) {
    console.error(`  ERROR scraping orangeburg-calhoun: ${e}`);
  }

  console.log(`\n${"=".repeat(60)}\nDone. Total: ${total} programs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
