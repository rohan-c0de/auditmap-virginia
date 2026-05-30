/**
 * scrape-programs.ts — scrape degree/program requirements for Virginia
 * community colleges (VCCS) from their individual Acalog catalogs.
 *
 * Coverage as of 2026-05: 20 of 23 VCCS colleges. The 3 not covered here
 * use non-Acalog catalogs and are tracked in their own follow-up issues:
 *   brcc — CourseLeaf-powered catalog at catalog.brcc.edu
 *   camp — PDF-only catalog hosted on Google Drive
 *   vhcc — PDF-only catalog at vhcc.edu
 *
 * Catoids are pinned because VCCS Acalog instances use dropdown values
 * for content types (not catalog editions), so auto-discovery picks the
 * wrong catoid. Navoids were identified by scanning each catalog's main
 * nav for links containing "program / degree / certificate / associate";
 * the shared library filters out navoids that contain no program POIDs at
 * scrape time.
 *
 * Usage:
 *   npx tsx scripts/va/scrape-programs.ts
 *   npx tsx scripts/va/scrape-programs.ts --college gcc     # single college
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

// ---------------------------------------------------------------------------
// VCCS colleges with confirmed Acalog catalogs
// ---------------------------------------------------------------------------

const COLLEGES: AcalogProgramConfig[] = [
  // Original 4 from the prototype.
  {
    collegeSlug: "gcc",
    baseUrl: "https://catalog.germanna.edu",
    catoidFallback: 15,
    programNavoids: [453],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "pvcc",
    baseUrl: "https://catalog.pvcc.edu",
    catoidFallback: 9,
    programNavoids: [1076],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "nova",
    baseUrl: "https://nvcc.catalog.acalog.com",
    catoidFallback: 15,
    programNavoids: [1882],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "mecc",
    baseUrl: "https://catalog.mecc.edu",
    catoidFallback: 6,
    programNavoids: [408],
    autoDiscoverCatoid: false,
  },
  // 16 added for full VCCS coverage.
  {
    collegeSlug: "brightpoint",
    baseUrl: "https://catalog.brightpoint.edu",
    catoidFallback: 12,
    programNavoids: [1157],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "cvcc",
    baseUrl: "https://catalog.centralvirginia.edu",
    catoidFallback: 6,
    programNavoids: [208, 210],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "dcc",
    baseUrl: "https://catalog.danville.edu",
    catoidFallback: 7,
    programNavoids: [222, 245, 257],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "escc",
    baseUrl: "https://catalog.es.vccs.edu",
    catoidFallback: 13,
    programNavoids: [1351, 1358, 1426],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "laurelridge",
    baseUrl: "https://catalog.laurelridge.edu",
    catoidFallback: 25,
    programNavoids: [995, 996],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "mgcc",
    baseUrl: "https://catalog.mgcc.edu",
    catoidFallback: 8,
    programNavoids: [402, 421, 428],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "nrcc",
    baseUrl: "https://catalog.nr.edu",
    catoidFallback: 42,
    programNavoids: [3257, 3275],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "phcc",
    baseUrl: "https://catalog.patrickhenry.edu",
    catoidFallback: 11,
    programNavoids: [835, 838, 839, 841, 848],
    autoDiscoverCatoid: false,
  },
  {
    // The picked navoids are "Areas of Study" landing pages, not program
    // lists. Fall back to the search_advanced.php enumerator instead.
    collegeSlug: "rcc",
    baseUrl: "https://catalog.rappahannock.edu",
    catoidFallback: 8,
    programNavoids: [],
    autoDiscoverCatoid: false,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "reynolds",
    baseUrl: "https://catalog.reynolds.edu",
    catoidFallback: 10,
    programNavoids: [898, 903, 955],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "svcc",
    baseUrl: "https://catalog.southside.edu",
    catoidFallback: 13,
    programNavoids: [1612, 1623, 1664],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "swcc",
    baseUrl: "https://catalog.sw.edu",
    catoidFallback: 13,
    programNavoids: [761, 769, 771, 772, 814],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "tcc",
    baseUrl: "https://catalog.tcc.edu",
    catoidFallback: 23,
    programNavoids: [],
    autoDiscoverCatoid: false,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "vpcc",
    baseUrl: "https://catalog.vpcc.edu",
    catoidFallback: 26,
    programNavoids: [],
    autoDiscoverCatoid: false,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "vwcc",
    baseUrl: "https://catalog.virginiawestern.edu",
    catoidFallback: 25,
    programNavoids: [],
    autoDiscoverCatoid: false,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "wcc",
    baseUrl: "https://catalog.wcc.vccs.edu",
    catoidFallback: 14,
    programNavoids: [],
    autoDiscoverCatoid: false,
    useSearchDiscovery: true,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  const outDir = path.join(process.cwd(), "data", "va", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`VA program scraper — ${colleges.length} college(s)\n`);

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

      // Run the program-slug matcher
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );

      // Write output
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
