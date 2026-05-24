/**
 * scrape-colleague.ts — AZ Colleague Self-Service colleges.
 *
 * Two AZ colleges run on Ellucian Colleague Self-Service:
 *   - Mohave Community College — Ellucian Cloud (hosted)
 *   - Arizona Western College   — self-hosted (colss-prod.ec.azwestern.edu)
 *
 * AZ Western's selfservice.azwestern.edu redirects to colss-prod.ec.azwestern.edu,
 * which is the canonical Colleague Self-Service host. Verified 2026-05-24.
 * (At first probe the AZW server was returning 502 — Ellucian Cloud transient;
 * cron will pick it up when it's back. The scraper is wired so it can.)
 *
 * Usage:
 *   npx tsx scripts/az/scrape-colleague.ts
 *   npx tsx scripts/az/scrape-colleague.ts --college mohave-community-college
 *   npx tsx scripts/az/scrape-colleague.ts --no-import
 */

import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "mohave-community-college": "https://mohave-ss.colleague.elluciancloud.com",
  "arizona-western-college": "https://colss-prod.ec.azwestern.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;

  console.log("AZ Colleague scraper");
  console.log(`  Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeColleagueState({
    state: "az",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
