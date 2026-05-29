/**
 * Colorado — Colleague Self-Service scrape (1 college)
 *
 * Colorado Mountain College runs Ellucian Colleague Self-Service at
 *   https://selfservice.coloradomtn.edu/Student/Courses
 * with public guest access (page contains `isGuest = true` and the
 * guesthomecoursecatalogscripts bundle). CMC is the only standalone
 * CCCS-independent CO community college that runs Colleague; every
 * other CO college is on the shared CCCS Banner 8 cluster (see
 * scripts/co/scrape-cccs-banner8.ts).
 *
 * The auto-add-state fingerprinter detected CMC's Acalog catalog
 * subdomain (catalog.coloradomtn.edu) before the Colleague URL and
 * tagged it `acalog`, missing the SIS. Verified 2026-05-28 by direct
 * probe of selfservice.coloradomtn.edu/Student/Courses (HTTP 200,
 * 186 KB page with isGuest + Ellucian Colleague markers).
 *
 * No Supabase import here — the unified import-on-merge workflow picks
 * up JSON on main and runs schema validation + change detection.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "colorado-mountain-college": "https://selfservice.coloradomtn.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 CO Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "co",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ CO Colleague scraper failed:", err);
  process.exit(1);
});
