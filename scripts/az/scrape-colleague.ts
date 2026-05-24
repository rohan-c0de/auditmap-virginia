/**
 * scrape-colleague.ts — AZ Colleague Self-Service colleges.
 *
 * One AZ college (Mohave) runs on Ellucian Colleague Self-Service via
 * Ellucian Cloud. The orchestrator's fingerprint found it directly.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-colleague.ts
 *   npx tsx scripts/az/scrape-colleague.ts --college mohave-community-college
 *   npx tsx scripts/az/scrape-colleague.ts --no-import
 */

import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "mohave-community-college": "https://mohave-ss.colleague.elluciancloud.com",
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
