/**
 * Ohio — Colleague Self-Service scrape
 *
 * Thin wrapper around the shared Colleague template for the Ohio
 * colleges with public Colleague Self-Service instances. Originally
 * scraped via auto-add-state (#363) without a committed per-state
 * wrapper.
 *
 *   cincinnati-state-technical-and-community-college → selfservice.cincinnatistate.edu
 *
 * (Cincinnati State was originally fingerprinted as Banner SSB 9 by
 * auto-add-state, but selfservice.cincinnatistate.edu serves Colleague
 * Self-Service at /Student/Courses. The Colleague template applies.)
 *
 * No Supabase import here — the unified import-on-merge workflow picks
 * up JSON on main and runs schema validation + change detection.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "cincinnati-state-technical-and-community-college": "https://selfservice.cincinnatistate.edu",
  // Added via coverage-expansion + refingerprint workflow:
  "central-ohio-technical-college": "https://self-service.cotc.edu:8183",
  "columbus-state-community-college": "https://selfservice.cscc.edu",
  "hocking-college": "https://hocking.edu",
  "north-central-state-college": "https://colss-prod.ncscsaas.elluciancloud.com",
  "washington-state-community-college": "https://selfservice.wscc.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 OH Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "oh",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ OH Colleague scraper failed:", err);
  process.exit(1);
});
