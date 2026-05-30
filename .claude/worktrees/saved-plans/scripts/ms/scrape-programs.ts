/**
 * scrape-programs.ts — scrape degree/program requirements for
 * 6 Mississippi community colleges with Acalog catalogs.
 *
 * East MS CC may fail due to Imperva WAF TLS-level blocking.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "mgccc",
    baseUrl: "https://catalog.mgccc.edu",
    catoidFallback: 32,
    programNavoids: [3113],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "hinds",
    baseUrl: "https://catalog.hindscc.edu",
    catoidFallback: 22,
    programNavoids: [1040, 1041],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "eastms",
    baseUrl: "https://catalog.eastms.edu",
    catoidFallback: 6,
    programNavoids: [601],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "jcjc",
    baseUrl: "https://catalog.jcjc.edu",
    catoidFallback: 9,
    programNavoids: [638],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "meridian",
    baseUrl: "https://catalog.meridiancc.edu",
    catoidFallback: 6,
    programNavoids: [141],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "northwest",
    baseUrl: "https://catalog.northwestms.edu",
    catoidFallback: 8,
    programNavoids: [375],
    autoDiscoverCatoid: false,
  },
];

async function main() {
  const outDir = path.join(process.cwd(), "data", "ms", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`MS program scraper — ${COLLEGES.length} college(s)\n`);

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
