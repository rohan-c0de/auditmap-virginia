/**
 * scrape-programs.ts — scrape degree/program requirements for Massachusetts
 * community colleges from Acalog catalogs.
 *
 * Coverage as of 2026-05: 5 of 15 MA community colleges. The other 10
 * use non-Acalog catalog systems and are tracked in their own follow-up
 * issues:
 *   gcc        — Coursedog (existing prereq scraper handles courses)
 *   berkshire  — Smart Catalog IQ
 *   northshore — Smart Catalog IQ
 *   necc       — Smart Catalog IQ
 *   massasoit  — PDF-only catalog
 *   qcc        — PDF-only catalog
 *   mwcc       — CourseLeaf
 *   bristol    — custom Drupal-based catalog
 *   capecod    — static HTML, last update 2019-2020
 *   rcc        — catalog page sparse / unclear system
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-programs.ts
 *   npx tsx scripts/ma/scrape-programs.ts --college middlesex
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "middlesex",
    baseUrl: "https://catalog.middlesex.mass.edu",
    catoidFallback: 35,
    programNavoids: [3315],
    autoDiscoverCatoid: true,
  },
  {
    collegeSlug: "bhcc",
    baseUrl: "https://catalog.bhcc.edu",
    catoidFallback: 15,
    programNavoids: [786, 806, 807, 813],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "hcc",
    baseUrl: "https://catalog.hcc.edu",
    catoidFallback: 13,
    programNavoids: [562, 97],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "stcc",
    baseUrl: "https://catalog.stcc.edu",
    catoidFallback: 32,
    programNavoids: [6835],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "massbay",
    baseUrl: "https://massbay.catalog.acalog.com",
    catoidFallback: 15,
    programNavoids: [583],
    autoDiscoverCatoid: false,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1]
    || (args.indexOf("--college") >= 0
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

  console.log(`MA program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;

  for (const config of colleges) {
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
  console.log(`Done. Total: ${totalPrograms} programs across ${colleges.length} college(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
