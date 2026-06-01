/**
 * scrape-banner8.ts
 *
 * Missouri Banner 8 (legacy "classic" Banner) scraper. Currently covers:
 *   - state-fair-community-college → https://starssb.sfccmo.edu/PROD
 *
 * Thin wrapper around the shared template at scripts/lib/scrape-banner-8.ts.
 *
 * Discovered via the 2026-05-30 fingerprint re-baseline (#456 follow-up):
 * sfccmo.edu's homepage 503'd to the fingerprinter due to a Cloudflare
 * default-UA challenge, so the original sweep classified SFCC as "custom".
 * The Banner 8 host is fully public — `starssb.sfccmo.edu/PROD/bwckschd...`
 * returns the standard "Search for SFCC Courses" form.
 *
 * Usage:
 *   npx tsx scripts/mo/scrape-banner8.ts                  # all colleges
 *   npx tsx scripts/mo/scrape-banner8.ts --college state-fair-community-college
 *   npx tsx scripts/mo/scrape-banner8.ts --no-import
 */

import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  "state-fair-community-college": "https://starssb.sfccmo.edu/PROD",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeBanner8ByHost({
    state: "mo",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
