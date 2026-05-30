/**
 * NY SUNY CCs — Colleague Self-Service scrape
 *
 * Thin wrapper around the shared Colleague template for the three SUNY
 * community colleges with public Colleague Self-Service instances.
 * Verified live 2026-05-29.
 *
 *   finger-lakes-cc      → selfservice.flcc.edu
 *   onondaga-cc          → colss-prod.ec.sunyocc.edu  (non-canonical subdomain)
 *   tompkins-cortland-cc → selfservice.tc3.edu       (note tc3.edu vs.
 *                                                     tompkinscortland.edu)
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-suny-colleague.ts
 *   npx tsx scripts/ny/scrape-suny-colleague.ts --college=onondaga-cc
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "finger-lakes-cc": "https://selfservice.flcc.edu",
  "onondaga-cc": "https://colss-prod.ec.sunyocc.edu",
  // Tompkins Cortland (selfservice.tc3.edu) hosts Colleague Self-Service
  // at /SelfService but the catalog browse endpoint requires authentication —
  // /Student/Courses returns 404 unauthenticated. Tracked as DEFERRED-scrapers:
  // tompkins-cortland-cc needs auth/Playwright login flow.
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("NY SUNY Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "ny",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\nDone — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("NY Colleague scraper failed:", err);
  process.exit(1);
});
