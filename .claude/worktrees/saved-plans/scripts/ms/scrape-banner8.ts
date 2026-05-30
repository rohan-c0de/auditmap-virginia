/**
 * Mississippi — Banner 8 SSB scrape
 *
 * Thin wrapper around the shared Banner 8 template. Currently covers
 * the single MS college producing data — Meridian Community College —
 * originally bootstrapped during MS (#290) without a per-state course
 * wrapper.
 *
 *   meridian-community-college → ssb.meridiancc.edu/ssb/prod
 *
 * Meridian's host serves the classic (bwsk/bwck) Banner 8 endpoints;
 * page header reports "Banner Web Self-Service Release: 8.7.2.11".
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-banner8.ts
 *   npx tsx scripts/ms/scrape-banner8.ts --college meridian-community-college
 *   npx tsx scripts/ms/scrape-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  "meridian-community-college": "https://ssb.meridiancc.edu/ssb/prod",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🌲 Mississippi Banner 8 scraper");
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "ms",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ Mississippi Banner 8 scraper failed:", err);
  process.exit(1);
});
