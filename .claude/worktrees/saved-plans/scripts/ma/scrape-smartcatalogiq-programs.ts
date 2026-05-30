/**
 * scrape-smartcatalogiq-programs.ts — MA Smart Catalog IQ program scraper.
 *
 * Closes #238. Adds Berkshire CC, Northern Essex CC, and North Shore CC —
 * three MassCC colleges whose catalogs run on Smart Catalog IQ rather than
 * Acalog / Coursedog / CourseLeaf.
 *
 * Each college uses a slightly different catalog path:
 *   berkshire  /en/{year}/catalog/programs-of-study
 *   necc       /en/{year}/catalog/academic-programs
 *   northshore /en/{year}/college-catalog/credit-programs
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-smartcatalogiq-programs.ts
 *   npx tsx scripts/ma/scrape-smartcatalogiq-programs.ts --college berkshire
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { SmartCatalogIqProgramConfig } from "../lib/scrape-smartcatalogiq-programs.js";

const COLLEGES: SmartCatalogIqProgramConfig[] = [
  {
    collegeSlug: "berkshire",
    baseUrl: "https://berkshirecc.smartcatalogiq.com",
    catalogPath: "catalog",
    programsPath: "programs-of-study",
  },
  {
    collegeSlug: "necc",
    baseUrl: "https://necc.smartcatalogiq.com",
    catalogPath: "catalog",
    programsPath: "academic-programs",
  },
  {
    collegeSlug: "northshore",
    baseUrl: "https://northshore.smartcatalogiq.com",
    catalogPath: "college-catalog",
    programsPath: "credit-programs",
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
        `Unknown college: ${collegeArg}. Available: ${COLLEGES.map((c) => c.collegeSlug).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const outDir = path.join(process.cwd(), "data", "ma", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`MA SmartCatalogIQ program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeSmartCatalogIqPrograms(config);

      if (data.programs.length === 0) {
        console.log(
          `  No programs found for ${config.collegeSlug}, skipping.`,
        );
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
  console.log(
    `Done. Total: ${totalPrograms} programs across ${colleges.length} college(s).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
