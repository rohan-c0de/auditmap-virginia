/**
 * California — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for the California
 * community colleges reachable via public Banner Self-Service 9 endpoints.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-banner-ssb.ts
 *   npx tsx scripts/ca/scrape-banner-ssb.ts --college mt-san-antonio-college
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

// Top-level await is not supported with the CJS output format used by the
// cron runner's esbuild step. Wrap in main() so it compiles cleanly.
async function main() {
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
    // Coast CCD (3)
    "coastline-community-college":                "https://reg-prod.ec.cccd.edu",
    "golden-west-college":                        "https://reg-prod.ec.cccd.edu",
    "orange-coast-college":                       "https://reg-prod.ec.cccd.edu",
    // NOCCCD (2)
    "cypress-college":                            "https://ssb.nocccd.edu",
    "fullerton-college":                          "https://ssb.nocccd.edu",
    // Ventura CCD (3)
    "moorpark-college":                           "https://ssb.vcccd.edu",
    "oxnard-college":                             "https://ssb.vcccd.edu",
    "ventura-college":                            "https://ssb.vcccd.edu",
    // Singletons
    "gavilan-college":                            "https://reg-prod.ec.gavilan.edu",
    "pasadena-city-college":                      "https://reg-prod.ec.pasadena.edu",
    "porterville-college":                        "https://reg-prod.ec.kccd.edu",
  },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
