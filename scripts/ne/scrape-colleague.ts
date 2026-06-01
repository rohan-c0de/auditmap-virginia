/**
 * Nebraska — Colleague Self-Service scrape
 *
 * Thin wrapper around the shared Colleague template.
 *
 *   southeast-community-college-area    → selfservice.southeast.edu
 *   central-community-college           → colss-prod.ec.cccneb.edu
 *   metropolitan-community-college-area → colss-prod.ec.mccneb.edu
 *
 * Southeast was originally fingerprinted as "acalog" (catalog only at
 * catalog.southeast.edu), but the actual SIS is Colleague Self-Service
 * at selfservice.southeast.edu/Student/Courses — a non-canonical
 * subdomain the fingerprinter missed.
 *
 * Central was classified "unknown" because cccneb.edu is behind a
 * Cloudflare managed challenge (HTTP 403). The Colleague instance
 * lives outside the Cloudflare perimeter at colss-prod.ec.cccneb.edu.
 *
 * Metropolitan was classified "custom" in #947 (no SIS detected on
 * mccneb.edu — all canonical Colleague subdomains returned DNS
 * failure). The first deep-probe didn't try the colss-prod.ec.<domain>
 * pattern. Re-probe found the SIS at colss-prod.ec.mccneb.edu —
 * linked from mccneb.edu/student-links. ~13k students; closes the
 * largest remaining NE coverage gap.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "southeast-community-college-area": "https://selfservice.southeast.edu",
  "central-community-college": "https://colss-prod.ec.cccneb.edu",
  "metropolitan-community-college-area": "https://colss-prod.ec.mccneb.edu",
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
