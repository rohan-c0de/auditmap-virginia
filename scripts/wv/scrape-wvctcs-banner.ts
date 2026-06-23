/**
 * scrape-wvctcs-banner.ts
 *
 * Scrapes the WVCTCS colleges that run on the shared WVNET Banner SSB 9
 * infrastructure — one host per college at `xe<code>prod.wvnet.edu`. The
 * public class-search backend is open (HTTP 200, no WAF, no login): the
 * standard session-init + paginated searchResults flow, identical for all
 * six. Each college's own `*.edu` front door is a different gate — Ellucian
 * Experience SSO (bridgevalley/pierpont/southern), a sgcaptcha WAF
 * (newriver), or a JS schedule (blueridge) — but those gate *registration*,
 * not the backend Banner class search, so the WVNET host is the real source.
 *
 * Hosts verified public 2026-06 (each getTerms returns current terms).
 * (Was scrape-mountwest.ts — Mountwest was the first WVNET host wired; the
 * other five were found to share the same infrastructure.)
 *
 * NOT here — West Virginia Northern (wvncc): its WVNET host
 * (xewvnprod.wvnet.edu) has no SSB 9 / Banner 8 module deployed, and its
 * CollegeScheduler tenant is stale to Fall 2023. Documented as a course
 * ceiling in lib/states/wv/config.ts.
 *
 * Usage:
 *   npx tsx scripts/wv/scrape-wvctcs-banner.ts
 *   npx tsx scripts/wv/scrape-wvctcs-banner.ts --no-import
 */

import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb.js";

const HOSTS: Record<string, string> = {
  "mountwest": "https://xemctcprod.wvnet.edu",
  "blueridge": "https://xebrcprod.wvnet.edu",
  "bridgevalley": "https://xebvprod.wvnet.edu",
  "newriver": "https://xenrcprod.wvnet.edu",
  "pierpont": "https://xepierprod.wvnet.edu",
  "southern": "https://xesccprod.wvnet.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log("WV WVCTCS colleges — shared WVNET Banner SSB 9 (6 colleges)");
  await scrapeBannerSsbState({ state: "wv", hosts: HOSTS, noImport });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
