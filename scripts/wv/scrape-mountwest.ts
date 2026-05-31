/**
 * scrape-mountwest.ts
 *
 * Scrapes Mountwest Community and Technical College course sections from
 * Banner SSB 9 at xemctcprod.wvnet.edu. The endpoint is public with no
 * WAF or login wall — standard session-init + paginated searchResults flow.
 *
 * Usage:
 *   npx tsx scripts/wv/scrape-mountwest.ts
 *   npx tsx scripts/wv/scrape-mountwest.ts --no-import
 */

import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb.js";

const HOSTS: Record<string, string> = {
  "mountwest": "https://xemctcprod.wvnet.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log("WV Mountwest CTC — Banner SSB 9");
  await scrapeBannerSsbState({ state: "wv", hosts: HOSTS, noImport });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
