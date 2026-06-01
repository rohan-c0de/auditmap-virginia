/**
 * Missouri — Colleague Self-Service scrape
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * Missouri colleges with public Colleague Self-Service instances.
 * Originally scraped during auto-add-state (#395) without a committed
 * per-state wrapper; this restores that entry point so the unified
 * scheduled-scrape workflow can re-run them on cron.
 *
 *   east-central-college                 → selfservice.eastcentral.edu
 *   ozarks-technical-community-college   → central.otc.edu
 *   st-charles-community-college         → sccconnection.stchas.edu
 *
 * Hosts confirmed against each college's public /Student/Courses page.
 * (Auto-add-state's fingerprinter originally classified OTC as Banner
 * SSB 9; a fresh check of central.otc.edu shows it serves the Ellucian
 * Colleague Self-Service design system at /Student/Courses, so the
 * Colleague template applies.)
 *
 * Excluded — need re-fingerprint before wiring:
 *   - jefferson-college: MyJeffco is Google-SSO-gated; no public
 *     selfservice.* host surfaced. The auto-add-state run was able to
 *     scrape it (data present at data/mo/courses/jefferson-college/),
 *     so the host exists somewhere — needs a manual probe.
 *   - metropolitan-community-college-kansas-city: my.mcckc.edu now
 *     302s to experience.elluciancloud.com/mcckc (Ellucian Experience
 *     SaaS), which the Colleague template's REST endpoints don't reach.
 *     Needs an Experience-platform scraper or a fresh fingerprint.
 *
 * No Supabase import here — the unified import-on-merge workflow picks
 * up JSON on main and runs schema validation + change detection.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "east-central-college": "https://selfservice.eastcentral.edu",
  "ozarks-technical-community-college": "https://central.otc.edu",
  "st-charles-community-college": "https://sccconnection.stchas.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 MO Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "mo",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ MO Colleague scraper failed:", err);
  process.exit(1);
});
