/**
 * New Mexico — Colleague Self-Service scrape
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * NM colleges that run Colleague Self-Service:
 *
 *   san-juan-college → selfservice.sanjuancollege.edu:467
 *
 * Discovered via the 2026-05-30 fingerprint re-baseline (#456 follow-up):
 * the original sweep classified san-juan-college as "custom" because the
 * fingerprinter only probes standard HTTPS port 443; SJC's Self-Service
 * runs on a non-standard port 467. SJC's "current students" page links
 * directly to https://selfservice.sanjuancollege.edu:467/Student/Courses/Search.
 *
 * Usage:
 *   npx tsx scripts/nm/scrape-colleague.ts
 *   npx tsx scripts/nm/scrape-colleague.ts --college=san-juan-college
 *   npx tsx scripts/nm/scrape-colleague.ts --no-import
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "san-juan-college": "https://selfservice.sanjuancollege.edu:467",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];
  const noImport = args.includes("--no-import");

  console.log("🌵 NM Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "nm",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ NM Colleague scraper failed:", err);
  process.exit(1);
});
