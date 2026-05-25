/**
 * Ohio — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for the three
 * Ohio colleges with public Banner Self-Service Banner 9 instances.
 * Originally scraped via auto-add-state (#363) without a committed
 * per-state wrapper; this restores the entry point so the unified
 * scheduled-scrape workflow can re-run them on cron.
 *
 *   cuyahoga-community-college-district   → banstup.tri-c.edu
 *   stark-state-college                   → selfservice-registration.starkstate.edu
 *   terra-state-community-college         → banxe.terra.edu
 *
 * (Terra State was originally classified as Colleague by auto-add-state's
 * fingerprinter, but my.terra.edu's official Links page points "Banner
 * Self-Service" at banxe.terra.edu/BannerGeneralSsb — Banner, not
 * Colleague. The wrapper here treats it as Banner SSB 9.)
 *
 * Usage:
 *   npx tsx scripts/oh/scrape-banner-ssb.ts
 *   npx tsx scripts/oh/scrape-banner-ssb.ts --college stark-state-college
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

await scrapeBannerSsbState({
  state: "oh",
  hosts: {
    "cuyahoga-community-college-district": "https://banstup.tri-c.edu",
    "stark-state-college": "https://selfservice-registration.starkstate.edu",
    "terra-state-community-college": "https://banxe.terra.edu",
    // Added via coverage-expansion workflow: refingerprint captured the
    // courseSearchUrl https://zanestate.edu/StudentRegistrationSsb/ssb/...
    // and verified the StudentRegistrationSsb body marker. Unusually,
    // Banner SSB 9 is at the root domain rather than a subdomain.
    "zane-state-college": "https://zanestate.edu",
  },
});
