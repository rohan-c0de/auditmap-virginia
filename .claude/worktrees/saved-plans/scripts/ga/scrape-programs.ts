/**
 * scrape-programs.ts — scrape degree/program requirements for GA TCSG
 * colleges that run on Acalog catalogs.
 *
 * Acalog colleges (2 of 22):
 *   - wiregrass-tech   → catalog.wiregrass.edu
 *   - gwinnett-tech    → catalog.gwinnetttech.edu (catoid=19, navoid=3629)
 *
 * 13 other TCSG colleges use SmartCatalogIQ — handled by
 * scripts/ga/scrape-smartcatalogiq-programs.ts. The remaining 7 use
 * Nimble CMS (4), PDF-only (2), or CleanCatalog (1) — documented as
 * ceilings in lib/states/ga/config.ts.
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-programs.ts
 *   npx tsx scripts/ga/scrape-programs.ts --college gwinnett-tech
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "wiregrass-tech",
    baseUrl: "https://catalog.wiregrass.edu",
    catoidFallback: 2,
    programNavoids: [53],
    autoDiscoverCatoid: false,
  },
  {
    // catalog.gwinnetttech.edu is HTTP-only (HTTPS returns connection refused).
    // catoid=19 is the current catalog; navoid=3629 is "Programs of Study".
    collegeSlug: "gwinnett-tech",
    baseUrl: "http://catalog.gwinnetttech.edu",
    catoidFallback: 19,
    programNavoids: [3629],
    autoDiscoverCatoid: false,
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "ga", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`GA program scraper — ${COLLEGES.length} college(s)\n`);

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
