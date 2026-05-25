/**
 * Illinois — Colleague Self-Service scrape (3 colleges)
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * Illinois colleges identified as Ellucian Colleague (high confidence)
 * in the fingerprint sweep:
 *
 *   kankakee-community-college → selfservice.kcc.edu
 *   parkland-college           → parkland-ss.colleague.elluciancloud.com
 *   rock-valley-college        → colss-prod.ec.rockvalleycollege.edu
 *
 * No Supabase import here — the unified import-on-merge workflow handles
 * publication once JSON files land on main.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "kankakee-community-college": "https://selfservice.kcc.edu",
  "parkland-college": "https://parkland-ss.colleague.elluciancloud.com",
  "rock-valley-college": "https://colss-prod.ec.rockvalleycollege.edu",
  // Added via coverage-expansion + refingerprint workflow:
  "elgin-community-college": "https://selfservice.elgin.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 IL Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "il",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ IL Colleague scraper failed:", err);
  process.exit(1);
});
