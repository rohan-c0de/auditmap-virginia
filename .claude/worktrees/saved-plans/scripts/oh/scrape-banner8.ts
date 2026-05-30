/**
 * Ohio — Banner 8 SSB scrape
 *
 * Thin wrapper around the shared Banner 8 template for Ohio colleges
 * running the classic (bwck*) Banner 8 self-service. Originally scraped
 * via auto-add-state (#363) without a committed per-state wrapper.
 *
 *   james-a-rhodes-state-college → banner-prod.rhodesstate.edu/PRD9
 *
 * Rhodes State's host serves the standard Banner 8 endpoints
 * (bwckschd.p_disp_dyn_sched / bwckschd.p_get_crse_unsec).
 *
 * Usage:
 *   npx tsx scripts/oh/scrape-banner8.ts
 *   npx tsx scripts/oh/scrape-banner8.ts --college james-a-rhodes-state-college
 *   npx tsx scripts/oh/scrape-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  "james-a-rhodes-state-college": "https://banner-prod.rhodesstate.edu/PRD9",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🌰 Ohio Banner 8 scraper");
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "oh",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ Ohio Banner 8 scraper failed:", err);
  process.exit(1);
});
