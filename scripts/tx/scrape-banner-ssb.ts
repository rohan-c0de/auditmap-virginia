/**
 * Texas — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for TX colleges
 * with public Banner Self-Service Banner 9 instances. URL verified
 * guest-open (HTTP 200, no redirect to login) on 2026-05-28:
 *
 *   victoria-college   → https://xe-stu.victoriacollege.edu
 *   laredo-college     → https://reg-prod.laredo.elluciancloud.com:8103
 *                        (Laredo runs Banner SSB at a non-standard port on
 *                        the Ellucian Cloud hostname. Homepage nav links
 *                        directly to /StudentRegistrationSsb/ssb/term/
 *                        termSelection?mode=search at this host:port. The
 *                        port comes through verbatim in the Banner JSON API
 *                        endpoints, so the shared template works as-is.)
 *
 * (Vernon College was originally fingerprinted as Banner SSB at
 * www.vernoncollege.edu/StudentRegistrationSsb/... — that path is actually
 * the college website's custom 404 returning HTTP 200, not a real Banner
 * endpoint. Vernon runs Ellucian Colleague Cloud at
 * vernon-ss.colleague.elluciancloud.com, so it's handled by
 * scripts/tx/scrape-colleague.ts instead.)
 *
 * The TX Alamo District scraper at scripts/tx/scrape-alamo.ts also uses the
 * Banner SSB template but with a campus-description split — it's kept
 * separate because its single Banner instance maps to 5 college slugs.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-banner-ssb.ts
 *   npx tsx scripts/tx/scrape-banner-ssb.ts --college vernon-college
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  await scrapeBannerSsbState({
    state: "tx",
    hosts: {
      "victoria-college": "https://xe-stu.victoriacollege.edu",
      "laredo-college": "https://reg-prod.laredo.elluciancloud.com:8103",
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
