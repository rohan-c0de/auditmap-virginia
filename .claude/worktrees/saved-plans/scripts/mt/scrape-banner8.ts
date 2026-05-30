/**
 * Montana Banner 8 scraper — Dawson CC + Miles CC
 *
 * Both colleges run Banner 8 SSB instances on the Montana University System
 * infrastructure (*.umt.edu). Each has its own host with the standard
 * bwckschd.p_disp_dyn_sched / bwckschd.p_get_crse_unsec endpoints.
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-banner8.ts                         # all
 *   npx tsx scripts/mt/scrape-banner8.ts --college dawson-community-college
 *   npx tsx scripts/mt/scrape-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  "dawson-community-college": "https://ssbweb.dcc.umt.edu/dwsnssb",
  "miles-community-college": "https://ssbweb.mcc.umt.edu/milsssb",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🏔️  Montana Banner 8 scraper");
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "mt",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ Montana Banner 8 scraper failed:", err);
  process.exit(1);
});
