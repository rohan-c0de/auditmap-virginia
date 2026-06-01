/**
 * Nebraska — Colleague Self-Service scrape
 *
 * Thin wrapper around the shared Colleague template.
 *
 *   southeast-community-college-area → selfservice.southeast.edu
 *   central-community-college        → colss-prod.ec.cccneb.edu
 *
 * Southeast was originally fingerprinted as "acalog" (catalog only at
 * catalog.southeast.edu), but the actual SIS is Colleague Self-Service
 * at selfservice.southeast.edu/Student/Courses — a non-canonical
 * subdomain the fingerprinter missed.
 *
 * Central was classified "unknown" because cccneb.edu is behind a
 * Cloudflare managed challenge (HTTP 403). The Colleague instance
 * lives outside the Cloudflare perimeter at colss-prod.ec.cccneb.edu.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "southeast-community-college-area": "https://selfservice.southeast.edu",
  "central-community-college": "https://colss-prod.ec.cccneb.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("📚 NE Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "ne",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ NE Colleague scraper failed:", err);
  process.exit(1);
});
