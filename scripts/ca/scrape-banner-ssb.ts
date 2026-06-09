/**
 * California — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for the California
 * community colleges reachable via public Banner Self-Service 9 endpoints.
 *
 * Multi-college Banner DISTRICTS (one shared instance -> several colleges,
 * split by campusDescription) are NOT handled here -- they live in
 * scripts/ca/scrape-banner-cluster.ts (SMCCCD, CLPCCD, Kern CCD). Listing a
 * shared-instance college in both places would double-scrape and mix the
 * district's sections.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-banner-ssb.ts
 *   npx tsx scripts/ca/scrape-banner-ssb.ts --college mt-san-antonio-college
 *   npx tsx scripts/ca/scrape-banner-ssb.ts --college college-of-the-sequoias --no-import
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

// Top-level await is not supported with the CJS output format used by the
// cron runner's esbuild step. Wrap in main() so it compiles cleanly.
async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");
  await scrapeBannerSsbState({
  state: "ca",
  collegeFilter,
  noImport,
  hosts: {
    "antelope-valley-community-college-district": "https://ssb.avc.edu",
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
    // College of the Sequoias (Sequoias CCD) -- single college; all campuses
    // (Visalia / Tulare / Hanford) are COS sites, no cross-college filter.
    "college-of-the-sequoias":                    "https://banweb.cos.edu",
    // Feather River College -- single college, Ellucian Cloud Banner SSB 9
    // on non-standard port 8118.
    "feather-river-community-college-district":   "https://reg-prod.frc.elluciancloud.com:8118",
    // NOTE: bakersfield-college, porterville-college and cerro-coso-community-college
    // (Kern CCD) all share https://reg-prod.ec.kccd.edu. They are scraped by
    // scripts/ca/scrape-banner-cluster.ts, which buckets the shared instance by
    // campusDescription (BC / Porterville / CC). Do not add them here.
  },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
