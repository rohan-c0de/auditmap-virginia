/**
 * Wyoming — Colleague Self-Service scrape (5 colleges)
 *
 * All 7 Wyoming CC colleges (WCCC system) run Ellucian Colleague, but each
 * on a different subdomain with non-canonical patterns:
 *
 *   eastern-wyoming-college          → selfservice.ewc.wy.edu  (selfservice.*)
 *   laramie-county-community-college → www2.lccc.wy.edu        (www2.* — unusual)
 *   western-wyoming-community-college→ selfservice.westernwyoming.edu
 *   casper-college                   → fremontpeak.caspercollege.edu  (<landmark>.*)
 *   northern-wyoming-cc-district     → nwccdss.sheridan.edu    (<districtcode>ss.*)
 *
 * The fingerprinter missed all five because it probes only selfservice.*,
 * selfserv.*, ssb.*, and a few other patterns but not www2.*, landmark-
 * prefix, or district-code-prefix subdomains.
 *
 * NOT included (genuine public-access blockers):
 *   central-wyoming-college   — www.cwc.edu/course-search/ is behind Cloudflare WAF;
 *                               all SIS subdomains return DNS NXDOMAIN. Re-probe when
 *                               Cloudflare session can be solved (Playwright).
 *   northwest-college         — nwc.edu links to wyclass.org (third-party event
 *                               aggregator) for its class schedule; no self-hosted
 *                               SIS endpoint found on any probed subdomain.
 *
 * Guest endpoint pattern: /Student/Courses/Search (returns 200 without auth)
 * Login redirect pattern: /Student/Courses → Account/Login (not usable)
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "eastern-wyoming-college":
    "https://selfservice.ewc.wy.edu",
  "laramie-county-community-college":
    "https://www2.lccc.wy.edu",
  "western-wyoming-community-college":
    "https://selfservice.westernwyoming.edu",
  "casper-college":
    "https://fremontpeak.caspercollege.edu",
  "northern-wyoming-community-college-district":
    "https://nwccdss.sheridan.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🦬 WY Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length} of 7 WCCC colleges`);

  const result = await scrapeColleagueState({
    state: "wy",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`,
  );
}

main().catch((err) => {
  console.error("❌ WY Colleague scraper failed:", err);
  process.exit(1);
});
