/**
 * Alabama Community College System (ACCS) — shared Banner 8 scraper
 *
 * Most ACCS colleges expose course data on a shared Banner 8 host at
 *   https://ssb-prod.ec.accs.edu/PROD/<CODE>/bwckschd.p_disp_dyn_sched
 * where <CODE> is a per-college 3–6 char identifier (CVCC, JSCC, etc.).
 *
 * Origin: 6 AL colleges already have committed course data in
 * data/al/courses/ (apparently from a one-off scrape pre-PR #292) but
 * no scraper file lived in scripts/al/ and the state config has
 * `// manual-only: courses — Phase 2 not yet wired up`. This PR fills
 * that gap with a single shared scraper covering as many ACCS colleges
 * as we have confirmed codes for, and wires it into cron.
 *
 * Wraps scripts/lib/scrape-banner-8.ts (the same template FL #454 uses
 * for fgc + cfk). Each (slug, baseUrl) entry in HOSTS maps to one
 * college. baseUrl = "https://ssb-prod.ec.accs.edu/PROD/<CODE>" — the
 * template appends the bwckschd / bwckctlg paths.
 *
 * Confirmed codes (probed against the host's bwckschd endpoint):
 *   CVCC   chattahoochee-valley-community-college           [has data]
 *   ESCC   enterprise-state-community-college               [has data]
 *   GSCC   gadsden-state-community-college                  [has data]
 *   WCCS   george-c-wallace-community-college-dothan        [has data]
 *   SUSCC  southern-union-state-community-college           [has data]
 *   CACC   coastal-alabama-community-college                [has data]
 *   JSCC   jefferson-state-community-college
 *   WSCC   george-c-wallace-state-community-college-hanceville
 *   TSCC   h-councill-trenholm-state-community-college
 *   NWSCC  northwest-shoals-community-college
 *   LBWCC  lurleen-b-wallace-community-college
 *   MMI    marion-military-institute
 *   RSTC   reid-state-technical-college
 *   LAWSON lawson-state-community-college
 *   BISHOP bishop-state-community-college
 *   NACC   northeast-alabama-community-college
 *   SNEAD  snead-state-community-college
 *   BSCC   bevill-state-community-college
 *
 * Not yet mapped (probes inconclusive; deferred to a follow-up):
 *   central-alabama-community-college
 *   george-c-wallace-state-community-college-selma
 *   j-f-drake-state-community-and-technical-college
 *   john-c-calhoun-state-community-college
 *   shelton-state-community-college
 *
 * Usage:
 *   npx tsx scripts/al/scrape-accs-banner8.ts                          # all
 *   npx tsx scripts/al/scrape-accs-banner8.ts --college jefferson-state-community-college
 *   npx tsx scripts/al/scrape-accs-banner8.ts --no-import
 */
import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";

const BASE = "https://ssb-prod.ec.accs.edu/PROD";

const HOSTS: Record<string, string> = {
  // Already had committed data (re-scrape under cron control):
  "chattahoochee-valley-community-college": `${BASE}/CVCC`,
  "coastal-alabama-community-college": `${BASE}/CACC`,
  "enterprise-state-community-college": `${BASE}/ESCC`,
  "gadsden-state-community-college": `${BASE}/GSCC`,
  "george-c-wallace-community-college-dothan": `${BASE}/WCCS`,
  "southern-union-state-community-college": `${BASE}/SUSCC`,
  // Newly mapped (no prior course data):
  "jefferson-state-community-college": `${BASE}/JSCC`,
  "george-c-wallace-state-community-college-hanceville": `${BASE}/WSCC`,
  "h-councill-trenholm-state-community-college": `${BASE}/TSCC`,
  "northwest-shoals-community-college": `${BASE}/NWSCC`,
  // lurleen-b-wallace-community-college moved to OneACCS Banner SSB 9
  // (scrape-accs-banner-ssb9.ts) — LBWCC's official "Schedule of Classes"
  // link points to reg-prod.ec.accs.edu/...?mepCode=LBWCC, not this host.
  // marion-military-institute does not publish a course schedule on either
  // ACCS cluster; the registrar page has no SIS link at all. Tracked as a
  // known-blocked ceiling — left out of HOSTS so the scraper doesn't
  // re-log "no terms" on every run.
  "reid-state-technical-college": `${BASE}/RSTC`,
  "lawson-state-community-college": `${BASE}/LAWSON`,
  "bishop-state-community-college": `${BASE}/BISHOP`,
  "northeast-alabama-community-college": `${BASE}/NACC`,
  "snead-state-community-college": `${BASE}/SNEAD`,
  "bevill-state-community-college": `${BASE}/BSCC`,
  // J. F. Drake State is also on the Banner 8 cluster. The other newly-
  // mapped ACCS colleges (central-alabama, calhoun-state, wallace-selma,
  // shelton-state) live on the OneACCS Banner SSB 9 host — see
  // scripts/al/scrape-accs-banner-ssb9.ts.
  "j-f-drake-state-community-and-technical-college": `${BASE}/DRAKE`,
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🌽 ACCS Banner 8 scraper");
  console.log(`   Host: ${BASE}/<CODE>`);
  console.log(`   Colleges: ${Object.keys(HOSTS).length}`);

  await scrapeBanner8ByHost({
    state: "al",
    hosts: HOSTS,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error("❌ ACCS Banner 8 scraper failed:", err);
  process.exit(1);
});
