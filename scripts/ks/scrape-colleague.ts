/**
 * Kansas — Colleague Self-Service scrape (4 colleges)
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * four Kansas colleges that publish public Colleague Self-Service
 * catalogs. Discovered during the auto-add-state run (PR adding KS) via
 * the untouchable-investigator triage — KCKCC at selfservice.kckcc.edu
 * (the orchestrator probed my.kckcc.edu and hit a non-JSON response),
 * and three Ellucian-Cloud-hosted instances at their per-tenant
 * subdomains.
 *
 *   kansas-city-kansas-community-college → selfservice.kckcc.edu
 *   coffeyville-community-college        → coffey-ss.colleague.elluciancloud.com
 *   highland-community-college           → colss-prod.highldsaas.elluciancloud.com
 *   independence-community-college       → indycc-ss.colleague.elluciancloud.com
 *
 * Hosts confirmed by HTTP 200 + DOMPurify markers on each
 * /Student/Courses page during investigation.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "kansas-city-kansas-community-college": "https://selfservice.kckcc.edu",
  "coffeyville-community-college": "https://coffey-ss.colleague.elluciancloud.com",
  "highland-community-college": "https://colss-prod.highldsaas.elluciancloud.com",
  "independence-community-college": "https://indycc-ss.colleague.elluciancloud.com",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 KS Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "ks",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
