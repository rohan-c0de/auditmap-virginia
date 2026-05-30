/**
 * scrape-programs.ts — scrape degree/program requirements for
 * Delaware Technical Community College (DTCC) from dtcc.smartcatalogiq.com.
 *
 * DTCC is the only community college in Delaware.
 *
 * Usage:
 *   npx tsx scripts/de/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { SmartCatalogIqProgramConfig } from "../lib/scrape-smartcatalogiq-programs.js";

const COLLEGES: SmartCatalogIqProgramConfig[] = [
  {
    collegeSlug: "dtcc",
    baseUrl: "https://dtcc.smartcatalogiq.com",
    catalogPath: "catalog",
    catalogYear: "2025-2026",
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "de", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`DE program scraper — ${COLLEGES.length} college(s)\n`);

  let totalPrograms = 0;

  for (const config of COLLEGES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeSmartCatalogIqPrograms(config);

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
