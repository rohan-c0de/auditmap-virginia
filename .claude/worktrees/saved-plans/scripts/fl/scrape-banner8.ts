/**
 * scrape-banner8.ts
 *
 * Florida Banner 8 (legacy "classic" Banner) scraper. Covers the two FCS
 * colleges that run on Banner 8 instead of Banner SSB 9:
 *   - fgc — Florida Gateway College  (https://my.fgc.edu/PROD)
 *   - cfk — The College of the Florida Keys (https://secure.cfk.edu/prod)
 *
 * Thin wrapper around the shared template at scripts/lib/scrape-banner-8.ts.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-banner8.ts             # both colleges
 *   npx tsx scripts/fl/scrape-banner8.ts --college fgc
 *   npx tsx scripts/fl/scrape-banner8.ts --no-import
 */

import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  fgc: "https://my.fgc.edu/PROD",
  cfk: "https://secure.cfk.edu/prod",
  // Added via coverage-expansion + refingerprint workflow.
  // FSW courseSearchUrl: https://ssb.fsw.edu/PROD/bwckschd... → /PROD path matches.
  fsw: "https://ssb.fsw.edu/PROD",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter =
    collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeBanner8ByHost({
    state: "fl",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
