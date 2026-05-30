/**
 * scrape-programs.ts — scrape degree/program requirements for CT State
 * Community College from catalog.ctstate.edu (Acalog).
 *
 * CT State is a single unified college with one catalog.
 *
 * Usage:
 *   npx tsx scripts/ct/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "ct-state",
    baseUrl: "https://catalog.ctstate.edu",
    catoidFallback: 24,
    programNavoids: [2935],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "ct", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`CT program scraper — ${COLLEGES.length} college(s)\n`);

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
