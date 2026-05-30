/**
 * scrape-programs.ts — scrape degree/program requirements for
 * Community College of Rhode Island (CCRI) from catalog.ccri.edu (CourseLeaf).
 *
 * CCRI is the only community college in Rhode Island.
 *
 * Usage:
 *   npx tsx scripts/ri/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CourseleafProgramConfig } from "../lib/scrape-courseleaf-programs.js";

const COLLEGES: CourseleafProgramConfig[] = [
  {
    collegeSlug: "ccri",
    baseUrl: "https://catalog.ccri.edu",
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "ri", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`RI program scraper — ${COLLEGES.length} college(s)\n`);

  let totalPrograms = 0;

  for (const config of COLLEGES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeCourseleafPrograms(config);

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
