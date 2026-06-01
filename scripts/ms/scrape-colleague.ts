/**
 * Mississippi — Ellucian Colleague Self-Service scraper.
 *
 * Wraps the shared scrape-colleague library for the MS Colleague colleges.
 *
 *   east-mississippi-community-college → https://colss-prod.ec.eastms.edu
 *
 * The fingerprinter previously categorized EMCC as "unknown" because its
 * Self-Service runs on the Ellucian-Cloud `colss-prod.ec.<domain>` subdomain
 * pattern rather than the canonical `selfservice.<domain>` or the
 * `<short>-ss.colleague.elluciancloud.com` host. Verified guest access at
 * /Student/Courses.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-colleague.ts
 *   npx tsx scripts/ms/scrape-colleague.ts --college east-mississippi-community-college
 *   npx tsx scripts/ms/scrape-colleague.ts --no-import
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const COLLEAGUE_COLLEGES: Record<string, string> = {
  "east-mississippi-community-college": "https://colss-prod.ec.eastms.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeColleagueState({
    state: "ms",
    hosts: COLLEAGUE_COLLEGES,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("Mississippi Colleague scraper failed:", err);
  process.exit(1);
});
