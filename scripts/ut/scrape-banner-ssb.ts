/**
 * Utah — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for Utah's two
 * IPEDS-classified community colleges. Both publish a publicly
 * accessible Banner SSB 9 guest endpoint; the auto-add-state
 * fingerprinter missed them because each is hosted at a non-canonical
 * subdomain (and SLCC also runs on non-standard port 8005).
 *
 *   snow-college                  → https://prod.snow.edu, app context
 *                                   `StudentRegistrationSelfService`
 *                                   (instead of the canonical
 *                                   `StudentRegistrationSsb`).
 *   salt-lake-community-college   → https://lbforms.slcc.edu:8005,
 *                                   canonical app context.
 *
 * Snow's catalog at catalog.snow.edu is CourseLeaf (programs/catalog
 * only — not section data); the live section schedule is the Banner
 * SSB 9 instance at prod.snow.edu.
 *
 * SLCC's student portal at experience.elluciancloud.com is Microsoft-
 * SSO-gated, but its public class search is a separate Banner SSB 9
 * instance linked from www.slcc.edu/schedule/searchable.aspx.
 *
 * Usage:
 *   npx tsx scripts/ut/scrape-banner-ssb.ts
 *   npx tsx scripts/ut/scrape-banner-ssb.ts --college snow-college
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  const collegeFilter = (() => {
    const idx = process.argv.indexOf("--college");
    return idx >= 0 ? process.argv[idx + 1] : undefined;
  })();

  await scrapeBannerSsbState({
    state: "ut",
    collegeFilter,
    hosts: {
      "snow-college": {
        baseUrl: "https://prod.snow.edu",
        appContext: "StudentRegistrationSelfService",
      },
      "salt-lake-community-college": "https://lbforms.slcc.edu:8005",
    },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
