/**
 * scrape-nimble-cms-programs.ts — GA Nimble CMS program scraper driver.
 *
 * 4 of Georgia's 22 TCSG colleges run the Nimble CMS catalog
 * (cms.nimble.education). All four share an identical HTML structure;
 * one parametrized template (scripts/lib/scrape-nimble-cms-programs.ts)
 * covers all of them.
 *
 *   albany-tech            → https://www.albanytech.edu
 *   south-ga-tech          → https://www.southgatech.edu
 *   southeastern-tech      → https://catalog.southeasterntech.edu (catalog subdomain)
 *   southern-regional-tech → https://southernregional.edu
 *
 * South GA Tech hides the flat /programs index behind a departments
 * hierarchy, so we use type-filtered indexes (degree / diploma / certificate)
 * instead.
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-nimble-cms-programs.ts
 *   npx tsx scripts/ga/scrape-nimble-cms-programs.ts --college albany-tech
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeNimbleCmsPrograms } from "../lib/scrape-nimble-cms-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { NimbleCmsProgramConfig } from "../lib/scrape-nimble-cms-programs.js";

const CATALOG_YEAR = "2025-2026";

const COLLEGES: NimbleCmsProgramConfig[] = [
  {
    collegeSlug: "albany-tech",
    baseUrl: "https://www.albanytech.edu",
    catalogYear: CATALOG_YEAR,
  },
  {
    // South GA Tech: flat /programs doesn't list everything; type-filtered
    // endpoints expose all programs reliably.
    collegeSlug: "south-ga-tech",
    baseUrl: "https://www.southgatech.edu",
    indexPaths: [
      "/college-catalog/current/programs/type/degree",
      "/college-catalog/current/programs/type/diploma",
      "/college-catalog/current/programs/type/certificate",
    ],
    catalogYear: CATALOG_YEAR,
  },
  {
    // Southeastern Tech runs Nimble on a dedicated catalog subdomain.
    collegeSlug: "southeastern-tech",
    baseUrl: "https://catalog.southeasterntech.edu",
    catalogYear: CATALOG_YEAR,
  },
  {
    collegeSlug: "southern-regional-tech",
    baseUrl: "https://southernregional.edu",
    catalogYear: CATALOG_YEAR,
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

  console.log(`GA Nimble CMS program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeNimbleCmsPrograms(config);
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
