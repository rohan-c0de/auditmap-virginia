/**
 * Pennsylvania — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for the two PA
 * community colleges fingerprinted as Banner SSB 9: Delaware County
 * Community College (DCCC) and Harrisburg Area Community College (HACC).
 * Together these two colleges enroll ~30k students — the largest pair of
 * PA CCs by enrollment.
 *
 * Other PA CCs run on Workday (Bucks), Jenzabar (CCBC, Penn Highlands),
 * Coursedog catalog (LCCC, Northampton), Acalog (Reading), various
 * SSO-gated portals (CCAC, MC3, Penn College, Thaddeus Stevens), or
 * custom HTML (Butler, Central PA, CCP, Lancaster, Luzerne, Northern PA,
 * Westmoreland) — those need separate scrapers.
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-banner-ssb.ts
 *   npx tsx scripts/pa/scrape-banner-ssb.ts --college dccc
 *   npx tsx scripts/pa/scrape-banner-ssb.ts --no-import
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeBannerSsbState({
    state: "pa",
    hosts: {
      dccc: "https://prod-xe-web-a.dccc.edu",
      hacc: "https://banxeappprod.hacc.edu",
      // LCCC was not surfaced by the auto-add-state fingerprinter because
      // the host sits on a non-canonical subdomain (`banwebssprod`, outside
      // the prefix list of bannerss/selfservice/ssb). The link is on
      // lccc.edu/course-and-text-book-search/.
      lccc: "https://banwebssprod.lccc.edu",
    },
    collegeFilter,
    noImport,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
