/**
 * Texas — Banner 8 SSB scrape
 *
 * Thin wrapper around the shared Banner 8 template for TX colleges whose
 * public class search is the classic (bwckschd / bwckgens) Banner 8
 * dynamic-schedule, not Banner SSB 9.
 *
 *   tyler-junior-college → ssbprod.tjc.edu:8100/prod
 *
 * Tyler runs Banner 8 on a non-standard host+port (ssbprod.tjc.edu:8100).
 * The fingerprinter missed it because it probes standard subdomains on
 * port 443; the host is linked from tjc.edu/coursesearch (public, no auth).
 * GET /prod/bwckschd.p_disp_dyn_sched returns the "Select Term or Date
 * Range" page with 7 live terms (Fall 2026 = 202710 … Winter 2025 = 202619),
 * and the standard bwckgens.p_proc_term_date / bwckschd.p_get_crse_unsec
 * endpoints respond, so the shared template works as-is. The port comes
 * through verbatim in every Banner URL. Verified 2026-06.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-banner8.ts
 *   npx tsx scripts/tx/scrape-banner8.ts --college tyler-junior-college
 *   npx tsx scripts/tx/scrape-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const HOSTS: Record<string, string> = {
  "tyler-junior-college": "https://ssbprod.tjc.edu:8100/prod",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🤠 Texas Banner 8 scraper");
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "tx",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ Texas Banner 8 scraper failed:", err);
  process.exit(1);
});
