/**
 * scrape-cleancatalog-programs.ts — MA CleanCatalog program scraper.
 *
 * Closes #242. Adds Cape Cod Community College (capecod), the one MassCC
 * college that publishes its catalog on the cleancatalog.io platform.
 *
 *   https://live-capecod.cleancatalog.io/
 *
 * (capecod.edu's catalog.capecod.edu still serves a frozen 2019-2020 static
 *  HTML mirror — the live catalog is now the CleanCatalog Drupal site.)
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-cleancatalog-programs.ts
 *   npx tsx scripts/ma/scrape-cleancatalog-programs.ts --college capecod
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CleanCatalogProgramConfig } from "../lib/scrape-cleancatalog-programs.js";

const COLLEGES: CleanCatalogProgramConfig[] = [
  {
    collegeSlug: "capecod",
    baseUrl: "https://live-capecod.cleancatalog.io",
    catalogYear: "2025-2026",
  },
  {
    // Bristol uses CleanCatalog at its own subdomain (catalog.bristolcc.edu)
    // rather than the live-{slug}.cleancatalog.io shared host. URL pattern
    // is also 2-segment (/{division}/{program-slug}) instead of Cape Cod's
    // 3-segment (/{division}/{credential}/{program-slug}). The shared lib
    // handles both shapes — see the credentialFromPath / credentialFromProse
    // fallback there.
    collegeSlug: "bristol",
    baseUrl: "https://catalog.bristolcc.edu",
    catalogYear: "2025-2026",
    indexPaths: ["/degrees", "/browse-certificates"],
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

  console.log(`MA CleanCatalog program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeCleanCatalogPrograms(config);

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
