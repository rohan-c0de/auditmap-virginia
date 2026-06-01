/**
 * Nebraska — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template.
 *
 *   northeast-community-college → reg-prod.ec.northeast.edu
 *
 * Northeast was originally fingerprinted as "auth-gated" because
 * my.northeast.edu redirects to Ellucian Experience → Microsoft SSO.
 * The actual class search lives on a separate Ellucian Cloud-hosted
 * Banner SSB 9 instance at reg-prod.ec.northeast.edu, linked from
 * the college's registration page. Fall 2026 returned 939 sections
 * with no authentication.
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-banner-ssb.ts
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  await scrapeBannerSsbState({
    state: "ne",
    hosts: {
      "northeast-community-college": "https://reg-prod.ec.northeast.edu",
    },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
