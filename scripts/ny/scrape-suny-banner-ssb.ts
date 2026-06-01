/**
 * NY SUNY CCs — Banner SSB 9 scrape
 *
 * Thin wrapper around the shared Banner SSB 9 template for SUNY
 * community colleges whose public class-search runs on a Banner SSB 9
 * instance at banner.<domain>/StudentRegistrationSsb. Fingerprinted
 * 2026-05-29.
 *
 *   suny-adirondack    → banner.sunyacc.edu
 *   jefferson-cc       → banner.sunyjefferson.edu
 *   columbia-greene-cc → banner.sunycgcc.edu
 *   dutchess-cc        → banner.sunydutchess.edu
 *   rockland-cc        → banner.sunyrockland.edu
 *   corning-cc         → banner.corning-cc.edu
 *   suny-broome-cc     → banner.sunybroome.edu
 *   suny-ulster        → banner.sunyulster.edu
 *
 * North Country CC is the one Banner-tagged college that does NOT have
 * a public SSB instance — banner.nccc.edu rejects unauthenticated traffic
 * and the only student-facing portal sits behind NTLM/Negotiate auth.
 * Tracked as a manual TODO; needs Playwright auth flow if ever pursued.
 *
 * Smoke-tested live 2026-05-29: 1,205 sections from SUNY Broome alone
 * across Fall 2026 + Summer 2026.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-suny-banner-ssb.ts
 *   npx tsx scripts/ny/scrape-suny-banner-ssb.ts --college suny-broome-cc
 */
import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";

async function main() {
  await scrapeBannerSsbState({
    state: "ny",
    hosts: {
      // Canonical banner.<domain> SSB 9 instances (8 colleges):
      "suny-adirondack": "https://banner.sunyacc.edu",
      "jefferson-cc": "https://banner.sunyjefferson.edu",
      "columbia-greene-cc": "https://banner.sunycgcc.edu",
      "dutchess-cc": "https://banner.sunydutchess.edu",
      "rockland-cc": "https://banner.sunyrockland.edu",
      "corning-cc": "https://banner.corning-cc.edu",
      "suny-broome-cc": "https://banner.sunybroome.edu",
      "suny-ulster": "https://banner.sunyulster.edu",
      // Non-canonical SSB 9 hosts (initial fingerprint mistakenly flagged
      // these as "PeopleSoft" off generic homepage strings; verified live
      // 2026-05-29 — all four sit on bespoke Banner subdomains):
      "monroe-cc": "https://bannerp.monroecc.edu",
      "nassau-cc": "https://banner.ncc.edu",
      "suffolk-cc": "https://lighthouse.sunysuffolk.edu",
      "suny-schenectady": "https://banprod.sunysccc.edu",
    },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
