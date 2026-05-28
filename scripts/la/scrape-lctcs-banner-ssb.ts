/**
 * Louisiana Community and Technical College System (LCTCS) — shared Banner SSB 9
 *
 * 11 of the 12 LCTCS member colleges expose course data on the shared Banner
 * SSB 9 host at https://reg-prod.ec.lctcs.edu, distinguished by a `mepCode`
 * query parameter on every API call. Same Ellucian Banner MEP pattern as
 * Alabama's OneACCS (see scripts/al/scrape-accs-banner-ssb9.ts).
 *
 * The orchestrator's fingerprinter missed this entirely: every college's
 * homepage links only to my.lctcs.edu (LoLA SSO) and never to the shared
 * guest endpoint. The guest URL is discoverable indirectly — Delgado's
 * Acalog catalog (catalog.dcc.edu) embeds the link, and apply.lctcs.edu
 * uses ?college=<mepCode> for prospective applicants.
 *
 * Northshore Technical CC is the 12th LCTCS member but does NOT use this
 * Banner host — it uses Coursedog. Handled separately (deferred).
 *
 * mepCode discovery:
 *   - CENLA, DCC, NUNEZ, NWLTC, BRCC, DELTA — confirmed by untouchable-
 *     investigator agent (probed each college's apply page and catalog).
 *   - BPCC, RPCC, SLCC, SOWELA, FTCC — confirmed by direct probe of the
 *     shared SSB host's getTerms endpoint.
 */
import { scrapeBannerSsbCollege } from "../lib/scrape-banner-ssb";

const LCTCS_BASE = "https://reg-prod.ec.lctcs.edu";

const COLLEGES: { slug: string; mepCode: string }[] = [
  { slug: "baton-rouge-community-college", mepCode: "BRCC" },
  { slug: "bossier-parish-community-college", mepCode: "BPCC" },
  { slug: "central-louisiana-technical-community-college", mepCode: "CENLA" },
  { slug: "delgado-community-college", mepCode: "DCC" },
  { slug: "fletcher-technical-community-college", mepCode: "FTCC" },
  { slug: "louisiana-delta-community-college", mepCode: "DELTA" },
  { slug: "northwest-louisiana-technical-community-college", mepCode: "NWLTC" },
  { slug: "nunez-community-college", mepCode: "NUNEZ" },
  { slug: "river-parishes-community-college", mepCode: "RPCC" },
  { slug: "south-louisiana-community-college", mepCode: "SLCC" },
  { slug: "sowela-technical-community-college", mepCode: "SOWELA" },
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

  console.log("🌶️  LCTCS Banner SSB 9 scraper");
  console.log(`   Host: ${LCTCS_BASE}`);
  console.log(`   Colleges: ${targets.length}`);

  let grandTotal = 0;
  const summary: { slug: string; total: number }[] = [];

  for (const c of targets) {
    try {
      const r = await scrapeBannerSsbCollege({
        state: "la",
        slug: c.slug,
        baseUrl: LCTCS_BASE,
        mepCode: c.mepCode,
      });
      summary.push({ slug: c.slug, total: r.totalSections });
      grandTotal += r.totalSections;
    } catch (err) {
      console.error(`❌ ${c.slug} (${c.mepCode}) failed:`, err);
      summary.push({ slug: c.slug, total: 0 });
    }
  }

  console.log("\n=== Summary ===");
  for (const s of summary) console.log(`  ${s.slug}: ${s.total} sections`);
  console.log(`  Total: ${grandTotal} sections across ${summary.length} colleges`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("la");
  }
}

main().catch((err) => {
  console.error("❌ LCTCS Banner SSB 9 scraper failed:", err);
  process.exit(1);
});
