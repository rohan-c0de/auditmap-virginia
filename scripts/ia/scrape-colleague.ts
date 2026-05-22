/**
 * Iowa — Colleague Self-Service scrape (2 colleges)
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * two Iowa colleges currently producing data under data/ia/courses/.
 * Both were scraped successfully during the auto-add-state run for IA
 * (PR #386) but no per-state wrapper was committed, so the unified
 * scheduled-scrape workflow had no entry point to re-run them on cron.
 *
 *   eastern-iowa-community-college-district → selfservice.eicc.edu
 *   iowa-western-community-college          → iwcc-ss.colleague.elluciancloud.com
 *
 * Hosts confirmed against each college's public /Student/Courses page.
 *
 * No Supabase import here — the unified import-on-merge workflow picks
 * up JSON on main and runs schema validation + change detection.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "eastern-iowa-community-college-district": "https://selfservice.eicc.edu",
  "iowa-western-community-college": "https://iwcc-ss.colleague.elluciancloud.com",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 IA Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "ia",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ IA Colleague scraper failed:", err);
  process.exit(1);
});
