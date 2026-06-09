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
      // Banner SSB 9 on the same non-standard :8103 port as Laredo. The WCJC
      // Pioneer Portal homepage is Ellucian Experience (SSO), but the underlying
      // SSB classSearch JSON API at reg-prod.wcjc.elluciancloud.com:8103 is
      // public — getTerms returns 9 terms, searchResults returns 892 Spring-2026
      // sections (CRN/seats/faculty). Linked from wcjc.edu's how-to-register
      // page. Verified 2026-06.
      "wharton-county-junior-college":
        "https://reg-prod.wcjc.elluciancloud.com:8103",
      // Banner SSB 9 at the standard Ellucian-Cloud reg-prod.ec host. The
      // college portal (generalssb-prod.ec.sanjac.edu) is SSO-gated and the
      // Acalog course-finder is AWS-WAF-walled, but the SSB classSearch JSON
      // API at reg-prod.ec.sanjac.edu is public — getTerms returns the live
      // credit terms (Fall/Spring/Summer 2026). Verified 2026-06.
      "san-jacinto-community-college": "https://reg-prod.ec.sanjac.edu",
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
