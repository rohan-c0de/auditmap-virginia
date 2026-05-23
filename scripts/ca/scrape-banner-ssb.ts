/**
 * California — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for the 14 California
 * community colleges that auto-add-state successfully scraped via Banner
 * Self-Service Banner 9 (48,610 sections combined). Three additional CA
 * colleges fingerprinted as Banner SSB 9 (butte, glendale, ohlone) but the
 * scrape returned 0 sections — they remain as TODOs for follow-up.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-banner-ssb.ts
 *   npx tsx scripts/ca/scrape-banner-ssb.ts --college mt-san-antonio-college
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

await scrapeBannerSsbState({
  state: "ca",
  hosts: {
    "antelope-valley-community-college-district": "https://ssb.avc.edu",
    "bakersfield-college":                        "https://reg-prod.ec.kccd.edu",
    "rio-hondo-college":                          "https://prod-ssb9-registration.riohondo.edu:8443",
    "solano-community-college":                   "https://ssb.solano.edu",
    "allan-hancock-college":                      "https://ssb.hancockcollege.edu",
    "barstow-community-college":                  "https://ssbprod2.barstow.edu:8443",
    "citrus-college":                             "https://ssb.citruscollege.edu",
    "compton-college":                            "https://cmptn-prod-pxes02.banner.elluciancloud.com:8090",
    "cuesta-college":                             "https://ssb2.cuesta.edu",
    "monterey-peninsula-college":                 "https://reg-prod.mpc.elluciancloud.com:8103",
    "mt-san-antonio-college":                     "https://prodrg.mtsac.edu",
    "santa-rosa-junior-college":                  "https://reg-prod.santarosajc.elluciancloud.com:8103",
    "sierra-college":                             "https://ss.oci.sierracollege.edu",
    "college-of-the-siskiyous":                   "https://reg-prod.cloud.siskiyous.edu",
  },
});
