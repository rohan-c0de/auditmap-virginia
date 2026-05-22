/**
 * Oregon — Colleague Self-Service scrape
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * one Oregon CC that runs Colleague Self-Service on Ellucian Cloud
 * (publicly accessible, no SSO required):
 *
 *   clatsop-community-college → clatsop-ss.colleague.elluciancloud.com
 *
 * Note: Rogue and Clackamas also run Colleague Self-Service but on their
 * own subdomains with mandatory SSO — no guest access, so they remain
 * uncovered until we get credentials.
 *
 * Usage:
 *   npx tsx scripts/or/scrape-colleague.ts
 *   npx tsx scripts/or/scrape-colleague.ts --college=clatsop-community-college
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "clatsop-community-college": "https://clatsop-ss.colleague.elluciancloud.com",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🌲 OR Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "or",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ OR Colleague scraper failed:", err);
  process.exit(1);
});
