/**
 * Arkansas — Ellucian Colleague Self-Service multi-college scraper.
 *
 * Wraps the shared scrape-colleague library for the AR Colleague colleges.
 * The orchestrator's fingerprint correctly identified all three as Colleague,
 * but Black River Technical College's primary domain is blackrivertech.edu
 * (marketing site) while the Self-Service instance lives at
 * selfservice.blackrivertech.ORG — that mismatch caused the orchestrator's
 * first scrape attempt to land at a non-existent .edu host and return 0
 * sections. Pinning the correct hosts here.
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-colleague.ts             # all 3 colleges, auto-discover terms
 *   npx tsx scripts/ar/scrape-colleague.ts --college black-river-technical-college
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const COLLEAGUE_COLLEGES: Record<string, string> = {
  "black-river-technical-college": "https://selfservice.blackrivertech.org",
  "north-arkansas-college": "https://my.northark.edu",
  "southeast-arkansas-college": "https://p2.seark.edu:8443",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeColleagueState({
    state: "ar",
    hosts: COLLEAGUE_COLLEGES,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
