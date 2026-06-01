/**
 * scrape-programs.ts — scrape degree/program requirements for Tennessee
 * community colleges from Acalog catalogs.
 *
 * TBR colleges share a common course numbering system. Pellissippi State
 * is the authoritative catalog source for prereqs (see scrape-catalog-prereqs.ts);
 * for programs, every TBR college with an Acalog catalog is scraped directly
 * because degree requirements vary by college.
 *
 * Coverage as of 2026-05: 11 of 12 active TBR community colleges.
 *   Excluded: jackson-state — publishes PDF-only catalogs, no Acalog instance.
 *   Excluded by config: roane-state — Ellucian Experience + SAML auth (see
 *     lib/states/tn/config.ts).
 *
 * Catoids are auto-discovered from the catalog dropdown. Navoids were
 * identified by scanning each catalog's main nav for links containing
 * "program / degree / certificate / associate"; the library filters out
 * navoids that contain no program POIDs at scrape time.
 *
 * Usage:
 *   npx tsx scripts/tn/scrape-programs.ts
 *   npx tsx scripts/tn/scrape-programs.ts --college pstcc
 *   npx tsx scripts/tn/scrape-programs.ts --limit 5     # smoke test
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "pstcc",
    baseUrl: "https://catalog.pstcc.edu",
    catoidFallback: 20,
    programNavoids: [1127, 1140, 1132],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "chattanooga-state",
    baseUrl: "https://catalog.chattanoogastate.edu",
    catoidFallback: 38,
    programNavoids: [8328, 8329],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "cleveland-state",
    baseUrl: "https://catalog.clevelandstatecc.edu",
    catoidFallback: 24,
    programNavoids: [1465, 1469],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "columbia-state",
    baseUrl: "https://catalog.columbiastate.edu",
    catoidFallback: 21,
    programNavoids: [2758, 2902, 926],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "dyersburg-state",
    baseUrl: "https://catalog.dscc.edu",
    catoidFallback: 48,
    programNavoids: [2894, 2914, 2934],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "motlow-state",
    baseUrl: "https://catalog.mscc.edu",
    catoidFallback: 26,
    programNavoids: [3256, 3269],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "nashville-state",
    baseUrl: "https://catalog.nscc.edu",
    catoidFallback: 24,
    programNavoids: [1619, 1658, 1659, 1660, 1670],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "northeast-state",
    baseUrl: "https://catalog.northeaststate.edu",
    catoidFallback: 44,
    programNavoids: [17164, 17165, 17167, 17174],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "southwest-tn",
    baseUrl: "https://catalog.southwest.tn.edu",
    catoidFallback: 41,
    programNavoids: [1785, 1791, 1826],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "volunteer-state",
    baseUrl: "https://catalog.volstate.edu",
    catoidFallback: 37,
    programNavoids: [1687, 1693, 1697, 1701, 1706, 1710, 1727, 1732],
    autoDiscoverCatoid: false,
  },
  {
    collegeSlug: "walters-state",
    baseUrl: "https://catalog.ws.edu",
    catoidFallback: 30,
    programNavoids: [2306],
    autoDiscoverCatoid: false,
    useSearchDiscovery: true,
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

  const outDir = path.join(process.cwd(), "data", "tn", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`TN program scraper — ${colleges.length} college(s)\n`);

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
