/**
 * Pennsylvania — Colleague Self-Service scrape
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the four
 * PA community colleges fingerprinted as Ellucian Colleague Self-Service:
 *
 *   ccac      selfservice.ccac.edu         Community College of Allegheny County
 *   luzerne   self-service.luzerne.edu     Luzerne County Community College
 *   mc3       selfservice.mc3.edu          Montgomery County Community College
 *   racc      prodselfservice.racc.edu     Reading Area Community College
 *
 * All four URLs serve the public Self-Service /Student/Courses page
 * (verified 2026-05-28 — 200 OK, no auth redirect).
 *
 * Combined with the Banner SSB scrapers (dccc, hacc, #697) and the Banner 8
 * scraper (ccp, #700), this covers 8 of PA's 15 community colleges. The
 * remaining 7 run on Workday (Bucks), Jenzabar JICS behind SAML (CCBC,
 * Penn Highlands), Coursedog catalog only (LCCC, Northampton), Acalog
 * catalog only (Reading) — though Reading also has Colleague for sections,
 * which is what we're scraping here. Penn College and Thaddeus Stevens
 * remain SSO-gated.
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-colleague.ts
 *   npx tsx scripts/pa/scrape-colleague.ts --college=ccac
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  ccac: "https://selfservice.ccac.edu",
  luzerne: "https://self-service.luzerne.edu",
  mc3: "https://selfservice.mc3.edu",
  racc: "https://prodselfservice.racc.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("PA Colleague scraper");
  console.log(`  Hosts: ${Object.keys(HOSTS).length}`);

  await scrapeColleagueState({
    state: "pa",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((err) => {
  console.error("PA Colleague scraper failed:", err);
  process.exit(1);
});
