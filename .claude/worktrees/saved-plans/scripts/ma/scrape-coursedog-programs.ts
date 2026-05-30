/**
 * scrape-coursedog-programs.ts — MA Coursedog program scraper.
 *
 * Closes #228 MA tail. Adds Greenfield Community College (gcc), the one
 * MassCC college whose catalog runs on Coursedog rather than CourseLeaf,
 * Acalog, SmartCatalogIQ, or CleanCatalog. Reuses the shared library
 * introduced for CUNY in #256.
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-coursedog-programs.ts
 *   npx tsx scripts/ma/scrape-coursedog-programs.ts --college gcc
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CoursedogProgramConfig } from "../lib/scrape-coursedog-programs.js";

const COLLEGES: CoursedogProgramConfig[] = [
  { collegeSlug: "gcc", catalogDomain: "catalog.gcc.mass.edu", catalogYear: "2025-2026" },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0 ? args[args.indexOf("--college") + 1] : null);

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

  console.log(`MA Coursedog program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.catalogDomain})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeCoursedogPrograms(config);
      if (data.programs.length === 0) {
        console.log(`  No programs scraped for ${config.collegeSlug}, skipping write.`);
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );
      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(
        `  ERROR scraping ${config.collegeSlug}: ${e instanceof Error ? e.message : e}`,
      );
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
