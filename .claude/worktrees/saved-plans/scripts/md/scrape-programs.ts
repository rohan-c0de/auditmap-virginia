/**
 * scrape-programs.ts — scrape degree/program requirements for
 * 3 Maryland community colleges with Acalog catalogs.
 *
 * Montgomery, PGCC, and Wor-Wic appear to have migrated off Acalog
 * (their catalog.* subdomains return empty/JS-rendered pages).
 *
 * Usage:
 *   npx tsx scripts/md/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "aacc",
    baseUrl: "https://catalog.aacc.edu",
    catoidFallback: 43,
    programNavoids: [18122],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "carroll",
    baseUrl: "https://catalog.carrollcc.edu",
    catoidFallback: 9,
    programNavoids: [597],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "csm",
    baseUrl: "https://catalog.csmd.edu",
    catoidFallback: 46,
    programNavoids: [5168],
    autoDiscoverCatoid: false,
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "md", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`MD program scraper — ${COLLEGES.length} college(s)\n`);

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
