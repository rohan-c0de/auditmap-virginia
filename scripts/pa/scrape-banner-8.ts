/**
 * Pennsylvania — Banner 8 scrape (CCP)
 *
 * Thin wrapper around the shared Banner 8 template for Community College
 * of Philadelphia, the third-largest PA CC (~16k students). CCP runs the
 * classic PL/SQL Banner 8 self-service interface at
 * https://oasis.ccp.edu:4051/pls/prod — discovered via a link from the
 * Drupal-hosted www.ccp.edu/admission-aid pages.
 *
 * The other 13 PA CCs run on Workday (Bucks), Jenzabar (CCBC, Penn
 * Highlands), Coursedog catalog (LCCC, Northampton), Acalog (Reading),
 * SSO-gated portals (CCAC, MC3, Penn College, Thaddeus Stevens), or
 * custom HTML (Butler, Central PA, Lancaster, Luzerne, Northern PA,
 * Westmoreland) — each needs its own scraper. Tracked in #100.
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-banner-8.ts
 *   npx tsx scripts/pa/scrape-banner-8.ts --college ccp
 *   npx tsx scripts/pa/scrape-banner-8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  ccp: "https://oasis.ccp.edu:4051/pls/prod",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeBanner8ByHost({
    state: "pa",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("PA Banner 8 scraper failed:", err);
  process.exit(1);
});
