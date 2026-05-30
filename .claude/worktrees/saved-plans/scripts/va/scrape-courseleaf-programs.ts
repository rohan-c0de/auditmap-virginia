/**
 * scrape-courseleaf-programs.ts — VA CourseLeaf program scraper.
 *
 * Closes #234. Adds Blue Ridge Community College (brcc), the one VCCS
 * college whose catalog is on CourseLeaf instead of Acalog (or PDF).
 *
 * Usage:
 *   npx tsx scripts/va/scrape-courseleaf-programs.ts
 *   npx tsx scripts/va/scrape-courseleaf-programs.ts --college brcc
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CourseleafProgramConfig } from "../lib/scrape-courseleaf-programs.js";

const COLLEGES: CourseleafProgramConfig[] = [
  {
    collegeSlug: "brcc",
    baseUrl: "https://catalog.brcc.edu",
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

  const outDir = path.join(process.cwd(), "data", "va", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`VA CourseLeaf program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeCourseleafPrograms(config);

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
