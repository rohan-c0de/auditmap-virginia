/**
 * New Mexico Banner 8 scraper — Northern New Mexico College
 *
 * NNMC runs a Banner 8 SSB instance on a non-standard port (4000).
 *
 * Usage:
 *   npx tsx scripts/nm/scrape-banner8.ts                         # all
 *   npx tsx scripts/nm/scrape-banner8.ts --college northern-new-mexico-college
 *   npx tsx scripts/nm/scrape-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  "northern-new-mexico-college": "https://prodssb1.nnmc.edu:4000/PRODODA",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🌵 New Mexico Banner 8 scraper");
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "nm",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ New Mexico Banner 8 scraper failed:", err);
  process.exit(1);
});
