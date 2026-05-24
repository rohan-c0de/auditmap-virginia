/**
 * scrape-banner-ssb.ts — AZ Banner SSB 9 colleges.
 *
 * Three AZ colleges run public Banner SSB 9 instances. The orchestrator's
 * generic fingerprint found Cochise and Pima at sensible subdomains but
 * mis-detected Coconino at `coconino.edu` (a plain WordPress site that
 * returns HTML where JSON was expected). The correct Coconino endpoint is
 * `registration.coconino.edu/StudentRegistrationSsb/...`.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-banner-ssb.ts
 *   npx tsx scripts/az/scrape-banner-ssb.ts --college coconino-community-college
 *   npx tsx scripts/az/scrape-banner-ssb.ts --no-import
 */

import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

const HOSTS: Record<string, string> = {
  "cochise-county-community-college-district": "https://ssb.cochise.edu",
  "pima-community-college": "https://ssb.pima.edu",
  "coconino-community-college": "https://registration.coconino.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("AZ Banner SSB 9 scraper");
  console.log(`  Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBannerSsbState({
    state: "az",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
