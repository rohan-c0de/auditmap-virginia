/**
 * scrape-programs.ts — scrape degree/program requirements for
 * CCSNH (Community College System of New Hampshire) colleges from
 * their Clean Catalog sites.
 *
 * 6 of 7 CCSNH colleges use Clean Catalog with /degrees pages.
 * Nashua CC uses a PDF catalog — not covered here.
 *
 * Usage:
 *   npx tsx scripts/nh/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CleanCatalogProgramConfig } from "../lib/scrape-cleancatalog-programs.js";

const COLLEGES: CleanCatalogProgramConfig[] = [
  {
    collegeSlug: "gbcc",
    baseUrl: "https://catalog.greatbay.edu",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "lrcc",
    baseUrl: "https://catalog.lrcc.edu",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "mccnh",
    baseUrl: "https://catalog.mccnh.edu",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "nhti",
    baseUrl: "https://catalog.nhti.edu",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "rvcc",
    baseUrl: "https://catalog.rivervalley.edu",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "wmcc",
    baseUrl: "https://catalog.wmcc.edu",
    catalogYear: "2025-2026",
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "nh", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`NH program scraper — ${COLLEGES.length} college(s)\n`);

  let totalPrograms = 0;

  for (const config of COLLEGES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeCleanCatalogPrograms(config);

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
