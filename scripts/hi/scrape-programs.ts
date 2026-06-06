/**
 * scrape-programs.ts — degree/program requirements for Hawaii community colleges.
 *
 * Of UH's 6 community colleges, only two publish a scrapeable online catalog:
 * Kauai CC and Windward CC both run Clean Catalog (catalog.<campus>.hawaii.edu).
 * The other four are platform ceilings (see lib/states/hi/config.ts
 * documentedCeilings.programs): Hawaii CC and Leeward CC use Kuali whose
 * program/group API is auth-gated (only the catalog list is public), Honolulu CC
 * is a bespoke WordPress catalog, and Kapiolani CC publishes PDFs only.
 *
 * Usage:
 *   npx tsx scripts/hi/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CleanCatalogProgramConfig } from "../lib/scrape-cleancatalog-programs.js";

const COLLEGES: CleanCatalogProgramConfig[] = [
  {
    collegeSlug: "kauai-community-college",
    baseUrl: "https://catalog.kauai.hawaii.edu",
    indexPaths: ["/degrees-and-certificates"],
    catalogYear: "2026-2027",
  },
  {
    collegeSlug: "windward-community-college",
    baseUrl: "https://catalog.windward.hawaii.edu",
    indexPaths: ["/degrees"],
    catalogYear: "2025-2026",
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "hi", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`HI program scraper — ${COLLEGES.length} college(s)\n`);
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
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);

      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
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
