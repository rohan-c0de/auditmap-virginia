/**
 * Mississippi — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template. Currently covers
 * Holmes Community College — the fingerprinter missed it because the SIS
 * is at the non-canonical `api.holmescc.edu` host (no ec-subdomain, no
 * ssb.* or selfservice.* alias).
 *
 *   holmes-community-college → https://api.holmescc.edu
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-banner-ssb.ts
 *   npx tsx scripts/ms/scrape-banner-ssb.ts --college holmes-community-college
 *   npx tsx scripts/ms/scrape-banner-ssb.ts --no-import
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeBannerSsbState({
    state: "ms",
    collegeFilter,
    noImport,
    hosts: {
      "holmes-community-college": "https://api.holmescc.edu",
    },
  });
}

main().catch((e) => {
  console.error("Mississippi Banner SSB scraper failed:", e);
  process.exit(1);
});
