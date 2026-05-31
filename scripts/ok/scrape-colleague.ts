/**
 * scrape-colleague.ts (Oklahoma)
 *
 * Five of Oklahoma's CCs run Ellucian Colleague Self-Service on publicly
 * accessible guest endpoints. The auto-add-state orchestrator's fingerprinter
 * missed all five — three got tagged "auth-gated" because the Ellucian
 * Experience portal aggregator (experience.elluciancloud.com) returned SSO,
 * and one got "custom HTML" because its Colleague subdomain (aggiesonline)
 * doesn't match the standard pattern. Direct probes confirmed every endpoint
 * below returns Colleague Self-Service over guest access.
 *
 * Usage:
 *   npx tsx scripts/ok/scrape-colleague.ts
 *   npx tsx scripts/ok/scrape-colleague.ts --college oklahoma-city-community-college
 *   npx tsx scripts/ok/scrape-colleague.ts --no-import
 */

import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "oklahoma-city-community-college": "https://colss-prod.ec.occc.edu",
  "redlands-community-college": "https://selfservice.redlandscc.edu",
  "western-oklahoma-state-college": "https://selfservice.wosc.edu",
  "carl-albert-state-college": "https://selfservice.carlalbert.edu",
  "murray-state-college": "https://aggiesonline.mscok.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeColleagueState({
    state: "ok",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
