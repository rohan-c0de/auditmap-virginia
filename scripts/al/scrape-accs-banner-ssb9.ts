/**
 * Alabama Community College System — OneACCS shared Banner SSB 9 (mepCode)
 *
 * Three ACCS colleges expose course data on the shared OneACCS Banner SSB 9
 * host at https://reg-prod.ec.accs.edu, distinguished by a `mepCode` query
 * parameter on every API call (not by URL path like the older
 * ssb-prod.ec.accs.edu Banner 8 cluster). Each (slug, mepCode) entry maps
 * to one college; the shared template at scripts/lib/scrape-banner-ssb.ts
 * already supports `mepCode` per-call (see ScrapeCollegeOptions.mepCode,
 * with a comment specifically calling out "Alabama's OneACCS").
 *
 * Discovered via WebFetch on each college's official "Schedule of Classes"
 * link. CACC, CCC, WCCS are mepCodes on THIS host — they map to different
 * colleges than the same-spelled path codes on the Banner 8 host
 * (ssb-prod.ec.accs.edu/PROD/<CODE>). For example:
 *
 *   Banner 8 cluster (ssb-prod, path-based):
 *     /PROD/CACC  → coastal-alabama-community-college
 *     /PROD/WCCS  → george-c-wallace-community-college-dothan
 *
 *   OneACCS Banner SSB 9 (reg-prod, mepCode-based):
 *     mepCode=CACC → central-alabama-community-college     (this PR)
 *     mepCode=WCCS → george-c-wallace-state-cc-selma       (this PR)
 *     mepCode=CCC  → john-c-calhoun-state-community-college (this PR)
 *
 * Closes the 3 of 5 unmapped AL colleges that turned out to be on a
 * different SIS generation than the rest. Remaining 2 (j-f-drake and
 * shelton-state) ARE on the Banner 8 cluster — handled in
 * scripts/al/scrape-accs-banner8.ts.
 */
import { scrapeBannerSsbCollege } from "../lib/scrape-banner-ssb";

const ONEACCS_BASE = "https://reg-prod.ec.accs.edu";

const COLLEGES: { slug: string; mepCode: string }[] = [
  { slug: "central-alabama-community-college", mepCode: "CACC" },
  { slug: "john-c-calhoun-state-community-college", mepCode: "CCC" },
  { slug: "george-c-wallace-state-community-college-selma", mepCode: "WCCS" },
  // SSCC also exists on the older Banner 8 host (ssb-prod.ec.accs.edu/PROD/SSCC)
  // and an earlier probe pulled real Shelton data there, but the OneACCS
  // Banner SSB 9 host is the authoritative current system per Shelton's
  // own "Schedule of Classes" link.
  { slug: "shelton-state-community-college", mepCode: "SSCC" },
  // lbwcc.edu's official "Schedule of Classes" link points here
  // (mepCode=LBWCC on reg-prod), not the Banner 8 ssb-prod host where
  // an older mapping had it. Moved 2026-05-24.
  { slug: "lurleen-b-wallace-community-college", mepCode: "LBWCC" },
  // wallacestate.edu's "Find Classes" link points here (mepCode=WSCC on
  // reg-prod). Previously mapped to ssb-prod.ec.accs.edu/PROD/WSCC, which
  // now returns 503. Same migration pattern as LBWCC. Moved 2026-05-30.
  { slug: "george-c-wallace-state-community-college-hanceville", mepCode: "WSCC" },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  const targets = collegeFilter
    ? COLLEGES.filter((c) => c.slug === collegeFilter)
    : COLLEGES;

  if (targets.length === 0) {
    const known = COLLEGES.map((c) => c.slug).join(", ");
    console.error(`Unknown college: ${collegeFilter}. Known: ${known}`);
    process.exit(1);
  }

  console.log("🌽 OneACCS Banner SSB 9 scraper");
  console.log(`   Host: ${ONEACCS_BASE}`);
  console.log(`   Colleges: ${targets.length}`);

  let grandTotal = 0;
  const summary: { slug: string; total: number }[] = [];

  for (const c of targets) {
    const r = await scrapeBannerSsbCollege({
      state: "al",
      slug: c.slug,
      baseUrl: ONEACCS_BASE,
      mepCode: c.mepCode,
    });
    summary.push({ slug: c.slug, total: r.totalSections });
    grandTotal += r.totalSections;
  }

  console.log("\n=== Summary ===");
  for (const s of summary) console.log(`  ${s.slug}: ${s.total} sections`);
  console.log(`  Total: ${grandTotal} sections across ${summary.length} colleges`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("al");
  }
}

main().catch((err) => {
  console.error("❌ OneACCS Banner SSB 9 scraper failed:", err);
  process.exit(1);
});
