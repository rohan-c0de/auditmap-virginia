/**
 * scrape-suny-acalog-programs.ts
 *
 * Scrapes degree/certificate program requirements for the 10 SUNY community
 * colleges that publish their catalogs through Acalog. Wraps the shared
 * `scrapeAcalogPrograms` template at scripts/lib/scrape-acalog-programs.ts.
 *
 * Coverage as of 2026-05-30:
 *   dutchess-cc       → catalog.sunydutchess.edu
 *   erie-cc           → catalog.ecc.edu
 *   herkimer-cc       → catalog.herkimer.edu
 *   hudson-valley-cc  → catalog.hvcc.edu
 *   onondaga-cc       → catalog.sunyocc.edu  (HTTP only — HTTPS 404s)
 *   suny-broome-cc    → catalog.sunybroome.edu
 *   suny-niagara      → catalog.niagaracc.suny.edu  (HTTP only)
 *   suny-orange       → sunyorange.catalog.acalog.com  (non-canonical tenant)
 *   suny-ulster       → sunyulster.catalog.acalog.com  (non-canonical tenant)
 *   westchester-cc    → catalog.sunywcc.edu
 *
 * The other 20 SUNY CCs use non-Acalog platforms (Clean Catalog, SCIQ,
 * CourseLeaf, WP JSON, OmniUpdate, PDF-only); see data/ny/_suny-catalog-fingerprint.md.
 *
 * Catoid + initial navoid values were probed from each catalog homepage on
 * 2026-05-30. `autoDiscoverCatoid: true` re-confirms the catoid at runtime
 * (Acalog rotates yearly), and `useSearchDiscovery: true` falls back to
 * `search_advanced.php` if the navoid yields zero programs.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-suny-acalog-programs.ts
 *   npx tsx scripts/ny/scrape-suny-acalog-programs.ts --college=dutchess-cc
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const COLLEGES: AcalogProgramConfig[] = [
  {
    collegeSlug: "dutchess-cc",
    baseUrl: "https://catalog.sunydutchess.edu",
    catoidFallback: 1,
    programNavoids: [15],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "erie-cc",
    baseUrl: "https://catalog.ecc.edu",
    catoidFallback: 27,
    programNavoids: [1407],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "herkimer-cc",
    baseUrl: "https://catalog.herkimer.edu",
    catoidFallback: 5,
    programNavoids: [285],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "hudson-valley-cc",
    baseUrl: "https://catalog.hvcc.edu",
    catoidFallback: 13,
    programNavoids: [685],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "onondaga-cc",
    baseUrl: "http://catalog.sunyocc.edu",
    catoidFallback: 15,
    programNavoids: [776],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "suny-broome-cc",
    baseUrl: "https://catalog.sunybroome.edu",
    catoidFallback: 1,
    programNavoids: [77],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "suny-niagara",
    baseUrl: "http://catalog.niagaracc.suny.edu",
    catoidFallback: 36,
    programNavoids: [2917],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "suny-orange",
    baseUrl: "https://sunyorange.catalog.acalog.com",
    catoidFallback: 3,
    programNavoids: [90],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "suny-ulster",
    baseUrl: "https://sunyulster.catalog.acalog.com",
    catoidFallback: 13,
    programNavoids: [50],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "westchester-cc",
    baseUrl: "https://catalog.sunywcc.edu",
    catoidFallback: 57,
    programNavoids: [10466],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
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

  const outDir = path.join(process.cwd(), "data", "ny", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`NY/SUNY Acalog program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeAcalogPrograms(config);
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
