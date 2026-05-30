/**
 * scrape-cleancatalog-programs.ts — GA CleanCatalog program scraper driver.
 *
 * One Georgia TCSG college runs CleanCatalog (Drupal 11 build) at a
 * self-hosted catalog subdomain:
 *
 *   coastal-pines-tech → https://catalog.coastalpines.edu
 *
 * Coastal Pines uses the same CleanCatalog template as Cape Cod and
 * Bristol (handled in scripts/lib/scrape-cleancatalog-programs.ts) — the
 * shared template was extended in this PR to recognize Coastal Pines'
 * `.degree-row-item a` course-code selector alongside the existing
 * `.col-2 a` / `.col-3 a` selectors used by the MA installs.
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-cleancatalog-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CleanCatalogProgramConfig } from "../lib/scrape-cleancatalog-programs.js";

const COLLEGES: CleanCatalogProgramConfig[] = [
  {
    collegeSlug: "coastal-pines-tech",
    baseUrl: "https://catalog.coastalpines.edu",
    catalogYear: "2025-2026",
  },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0
      ? args[args.indexOf("--college") + 1]
      : null);

  let colleges = COLLEGES;
  if (collegeArg) {
    colleges = COLLEGES.filter((c) => c.collegeSlug === collegeArg);
    if (colleges.length === 0) {
      console.error(
        `Unknown college: ${collegeArg}. Available: ${COLLEGES.map(
          (c) => c.collegeSlug,
        ).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const outDir = path.join(process.cwd(), "data", "ga", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`GA CleanCatalog program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
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
      console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR scraping ${config.collegeSlug}: ${e}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Done. Total: ${totalPrograms} programs across ${colleges.length} college(s).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
