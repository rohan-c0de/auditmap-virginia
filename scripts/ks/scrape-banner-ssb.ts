/**
 * Kansas — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for the one
 * KS college reachable via a public Banner Self-Service 9 endpoint:
 * Butler Community College. Originally scraped during the
 * auto-add-state run (PR adding KS) — committed here so the unified
 * scheduled-scrape workflow can re-run it on cron.
 *
 * Three other KS colleges initially attempted Banner SSB but were
 * routed elsewhere:
 *   - kansas-city-kansas-community-college → moved to Colleague (see scrape-colleague.ts)
 *   - salina-area-technical-college → IPC/sgcaptcha bot challenge (deferred)
 *   - seward-county-community-college → IPC/sgcaptcha bot challenge (deferred)
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-banner-ssb.ts
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  await scrapeBannerSsbState({
    state: "ks",
    hosts: {
      "butler-community-college": "https://banssreg1.butlercc.edu:8081",
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
