/**
 * Colorado Community College System (CCCS) — shared Banner 8 scraper
 *
 * All 13 CCCS colleges expose course data on a single shared Banner 8
 * host at
 *   https://erpdnssb.cccs.edu/<CODE>/bwckschd.p_disp_dyn_sched
 * where <CODE> is a per-college path (PRODACC, PRODCCD, etc.). The
 * shared host serves every CCCS college from one database — verified
 * 2026-05-28 by probing each path for a current-term dropdown.
 *
 * Origin: auto-add-state's Banner 8 template (scripts/lib/scrape-banner-8.ts)
 * auto-detected 8 of 13 colleges via standard Banner SSB / banner-8
 * fingerprint signals. The remaining 5 (Arapahoe, Lamar, Morgan, Otero,
 * Colorado Northwestern) didn't expose the standard markers on their
 * homepages but share the same Banner instance — discovered by probing
 * erpdnssb.cccs.edu with their CCCS path codes. This wrapper centralizes
 * all 13 so cron has one entry point and the cluster discovery survives.
 *
 * Wraps scripts/lib/scrape-banner-8.ts via scrapeBanner8ByHost. Each
 * (slug, baseUrl) pair maps to one college; the template appends the
 * bwckschd.p_get_crse_unsec section-search path.
 *
 * Usage:
 *   npx tsx scripts/co/scrape-cccs-banner8.ts                          # all
 *   npx tsx scripts/co/scrape-cccs-banner8.ts --college arapahoe-community-college
 *   npx tsx scripts/co/scrape-cccs-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const BASE = "https://erpdnssb.cccs.edu";

const HOSTS: Record<string, string> = {
  "arapahoe-community-college": `${BASE}/PRODACC`,
  "colorado-northwestern-community-college": `${BASE}/PRODCNCC`,
  "community-college-of-aurora": `${BASE}/PRODCCA`,
  "community-college-of-denver": `${BASE}/PRODCCD`,
  "front-range-community-college": `${BASE}/PRODFRCC`,
  "lamar-community-college": `${BASE}/PRODLCC`,
  "morgan-community-college": `${BASE}/PRODMCC`,
  "northeastern-junior-college": `${BASE}/PRODNJC`,
  "otero-college": `${BASE}/PRODOJC`,
  "pikes-peak-state-college": `${BASE}/PRODPPCC`,
  "pueblo-community-college": `${BASE}/PRODPCC`,
  "red-rocks-community-college": `${BASE}/PRODRRCC`,
  "trinidad-state-college": `${BASE}/PRODTSJC`,
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🏔️  CCCS Banner 8 scraper");
  console.log(`   Host: ${BASE}/<CODE>`);
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "co",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ CCCS Banner 8 scraper failed:", err);
  process.exit(1);
});
