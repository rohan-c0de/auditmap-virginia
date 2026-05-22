/**
 * scrape-banner-ssb.ts (OR)
 *
 * Thin wrapper around the shared Banner SSB 9 template for Oregon's 4
 * publicly accessible Banner colleges. Clackamas was fingerprinted as
 * Banner SSB but redirects to Colleague SSO — excluded.
 *
 * Usage:
 *   npx tsx scripts/or/scrape-banner-ssb.ts
 *   npx tsx scripts/or/scrape-banner-ssb.ts --college chemeketa-community-college
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

await scrapeBannerSsbState({
  state: "or",
  hosts: {
    "chemeketa-community-college":       "https://reg-ss.chemeketa.edu",
    "central-oregon-community-college":  "https://reg-prod.cocc.edu",
    "lane-community-college":            "https://my.lanecc.edu",
    "linn-benton-community-college":     "https://banner.linnbenton.edu:8458",
  },
});
