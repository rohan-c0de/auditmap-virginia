/**
 * scrape-programs-acalog.ts — scrape MN Acalog programs.
 *
 * 6 MnSCU community colleges publish their academic catalogs on Acalog
 * with public program listings. This script uses the shared
 * scripts/lib/scrape-acalog-programs.ts engine.
 *
 * Output: data/mn/programs/{slug}.json per college, matching the
 * CollegePrograms schema.
 *
 * Usage:
 *   npx tsx scripts/mn/scrape-programs-acalog.ts
 *   npx tsx scripts/mn/scrape-programs-acalog.ts --college century-college
 */
import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  { collegeSlug: "anoka-technical-college", baseUrl: "https://catalog.anokatech.edu", catoidFallback: 6, programNavoids: [292], autoDiscoverCatoid: true },
  { collegeSlug: "anoka-ramsey-community-college", baseUrl: "https://catalog.anokaramsey.edu", catoidFallback: 3, programNavoids: [141], autoDiscoverCatoid: true, usePlaywright: true },
  { collegeSlug: "century-college", baseUrl: "https://catalog.century.edu", catoidFallback: 23, programNavoids: [1602], autoDiscoverCatoid: true, usePlaywright: true },
  { collegeSlug: "dakota-county-technical-college", baseUrl: "https://catalog.dctc.edu", catoidFallback: 2, programNavoids: [43], autoDiscoverCatoid: true, usePlaywright: true },
  { collegeSlug: "inver-hills-community-college", baseUrl: "https://catalog.inverhills.edu", catoidFallback: 2, programNavoids: [40], autoDiscoverCatoid: false, usePlaywright: true },
  { collegeSlug: "saint-paul-college", baseUrl: "https://catalog.saintpaul.edu", catoidFallback: 5, programNavoids: [224], autoDiscoverCatoid: true, usePlaywright: true },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;

  const outDir = path.join(process.cwd(), "data", "mn", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  const targets = collegeFilter ? COLLEGES.filter((c) => c.collegeSlug === collegeFilter) : COLLEGES;
  console.log(`🌲 MN Acalog program scraper — ${targets.length} college(s)`);

  let totalPrograms = 0;
  for (const config of targets) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));
    try {
      const data = await scrapeAcalogPrograms(config);
      if (data.programs.length === 0) {
        console.log(`  No programs found, skipping write.`);
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ ${data.programs.length} programs → ${path.relative(process.cwd(), outPath)}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR ${config.collegeSlug}: ${e}`);
    }
  }
  console.log(`\nDone. Total: ${totalPrograms} programs across ${targets.length} colleges.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
