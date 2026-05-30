/**
 * scrape-programs.ts — scrape degree/program requirements for
 * 4 South Carolina technical colleges with Acalog catalogs.
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "central-carolina",
    baseUrl: "https://catalog.cctech.edu",
    catoidFallback: 14,
    programNavoids: [1331],
    autoDiscoverCatoid: true,
  },
  {
    collegeSlug: "spartanburg",
    baseUrl: "https://catalog.sccsc.edu",
    catoidFallback: 29,
    programNavoids: [2329],
    autoDiscoverCatoid: true,
  },
  {
    collegeSlug: "trident",
    baseUrl: "https://catalog.tridenttech.edu",
    catoidFallback: 6,
    programNavoids: [432],
    autoDiscoverCatoid: true,
  },
  {
    collegeSlug: "york",
    baseUrl: "https://catalog.yorktech.edu",
    catoidFallback: 11,
    programNavoids: [289],
    autoDiscoverCatoid: true,
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "sc", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`SC program scraper — ${COLLEGES.length} college(s)\n`);

  let totalPrograms = 0;

  for (const config of COLLEGES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeAcalogPrograms(config);

      if (data.programs.length === 0) {
        console.log(`  No programs found for ${config.collegeSlug}, skipping.`);
        continue;
      }

      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );

      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(
        `  ✓ Wrote ${data.programs.length} programs to ${outPath}`,
      );

      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR scraping ${config.collegeSlug}: ${e}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. Total: ${totalPrograms} programs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
