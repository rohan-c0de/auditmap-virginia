/**
 * scrape-colleague.ts — WI Colleague Self-Service colleges.
 *
 * Western Technical College runs Ellucian Colleague Self-Service on
 * Ellucian's cloud at westerntc-ss.colleague.elluciancloud.com. The
 * /student/courses path is publicly reachable (no SSO redirect) —
 * confirmed via untouchable-investigator probe 2026-05-30.
 *
 * The first-pass orchestrator fingerprint missed this because it probed
 * subdomains of westerntc.edu (selfservice/banner/ssb), which don't
 * exist; WTC's SIS lives on Ellucian's hosted infrastructure.
 *
 * Usage:
 *   npx tsx scripts/wi/scrape-colleague.ts
 *   npx tsx scripts/wi/scrape-colleague.ts --college western-technical-college
 *   npx tsx scripts/wi/scrape-colleague.ts --no-import
 */

import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "western-technical-college": "https://westerntc-ss.colleague.elluciancloud.com",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;

  console.log("WI Colleague scraper");
  console.log(`  Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeColleagueState({
    state: "wi",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
