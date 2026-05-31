/**
 * scrape-colleague.ts (Idaho)
 *
 * Three of Idaho's four community colleges run Ellucian Colleague
 * Self-Service on publicly-accessible guest endpoints. The fourth
 * (College of Southern Idaho) is on Campus Management Corp Portal
 * via a separate sidecar — see TODO in the PR body.
 *
 * Usage:
 *   npx tsx scripts/id/scrape-colleague.ts
 *   npx tsx scripts/id/scrape-colleague.ts --college north-idaho-college
 *   npx tsx scripts/id/scrape-colleague.ts --no-import
 */

import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "north-idaho-college": "https://websvcfe.nic.edu",
  "college-of-eastern-idaho": "https://colss-prod.ec.cei.edu",
  "college-of-western-idaho": "https://selfservice.cwi.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeColleagueState({
    state: "id",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
