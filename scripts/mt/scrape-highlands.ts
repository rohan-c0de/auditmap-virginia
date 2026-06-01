/**
 * scrape-highlands.ts — Highlands College of Montana Tech (Banner SSB 9).
 *
 * Highlands College is the 2-year / community-college division of Montana
 * Technological University (Montana Tech). It has no Banner host of its own —
 * its courses live in Montana Tech's public Banner SSB 9 at the non-canonical
 * Ellucian Cloud subdomain `reg-prod.ec.mtech.edu` (linked from
 * mtech.edu/academics/calendars/class-schedules/). That instance serves BOTH
 * campuses: North Campus = Montana Tech (4-year, not us) and South Campus =
 * Highlands College (our 2-year CC). We keep only `campusDescription ===
 * "South Campus"` sections — the AST/AHXR/CSTN/DDSN/DST vocational + allied-
 * health catalog Highlands publishes (~42 sections in Fall 2026-2027).
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-highlands.ts
 *   npx tsx scripts/mt/scrape-highlands.ts --no-import
 */

import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

const HOSTS = {
  "highlands-college-of-montana-tech": "https://reg-prod.ec.mtech.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log("MT Banner SSB 9 scraper — Highlands College of Montana Tech");
  console.log("  Host: reg-prod.ec.mtech.edu (shared with Montana Tech North Campus)");

  await scrapeBannerSsbState({
    state: "mt",
    hosts: HOSTS,
    noImport,
    hooks: {
      // The Banner host is shared with Montana Tech's 4-year North Campus.
      // Keep only Highlands College (South Campus) sections.
      sectionFilter: (s) => s.campusDescription === "South Campus",
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
