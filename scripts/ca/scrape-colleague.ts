/**
 * California — Colleague Self-Service scrape
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * California CCs that publicly expose an Ellucian Colleague Self-Service
 * instance.
 *
 * Of the original five TODOs (modesto, shasta, chaffey, lassen,
 * napa-valley), three landed in this PR after re-survey via the
 * untouchable-investigator. Plus southwestern, also surfaced by #595.
 * Closes 4 rows from issue #595.
 *
 * Re-survey lookups: hosts are non-uniform; don't pattern-guess.
 *   • napa-valley   — standard `colss-prod.ec.<domain>` cluster
 *   • shasta        — non-standard subdomain `mysc.<domain>`
 *   • lassen        — `webadvisor.<domain>` on non-standard port 8171
 *   • southwestern  — non-standard subdomain `collselfserv.<domain>`
 *
 * Still TODO from the original five:
 *   • modesto — turned out to be legacy WebAdvisor (v6.9.4) at
 *     piratesnet.mjc.edu, not modern Colleague Self-Service. Needs
 *     a separate scraper.
 *   • chaffey — re-survey pending.
 *
 * Auth-gated (Colleague but SAML-walled, no public guest path):
 *   • college-of-the-canyons (canyons.edu) → portalguard.canyons.edu
 *   • copper-mountain-community-college (cmccd.edu) →
 *     experience.elluciancloud.com SSO
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-colleague.ts
 *   npx tsx scripts/ca/scrape-colleague.ts --college=cabrillo-college
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "santa-ana-college":                          "https://colss-prod.cloud.rsccd.edu",
  "cabrillo-college":                           "https://cabrillo-ss.colleague.elluciancloud.com",
  "cuyamaca-college":                           "https://selfservice.gcccd.edu",
  "college-of-the-desert":                      "https://ss.collegeofthedesert.edu",
  "evergreen-valley-college":                   "https://colss-prod.ec.sjeccd.edu",
  "grossmont-college":                          "https://selfservice.gcccd.edu",
  "hartnell-college":                           "https://stuserv.hartnell.edu",
  "palo-verde-college":                         "https://prod-selfserv.paloverde.edu",
  "san-jose-city-college":                      "https://colss-prod.ec.sjeccd.edu",
  "victor-valley-college":                      "https://vvc-ss.colleague.elluciancloud.com",
  "yuba-college":                               "https://yc-self-service.yccd.edu",
  "woodland-community-college":                 "https://wcc-self-service.yccd.edu",
  // Added in this PR (closes 4 rows from issue #595):
  "napa-valley-college":                        "https://colss-prod.ec.napavalley.edu",
  "shasta-college":                             "https://mysc.shastacollege.edu",
  "lassen-community-college":                   "https://webadvisor.lassencollege.edu:8171",
  "southwestern-college":                       "https://collselfserv.swccd.edu",
  // TODO mt-san-jacinto-community-college-district — host
  // `selfservice.msjc.edu/css` strips `/Student` from request paths
  // (`/css/Student/Courses` 302s to `/css/Courses`), so the shared
  // template's hardcoded `/Student/Courses/...` endpoints land on
  // wrong URLs. Needs lib support for a per-host `pathStripsStudent`
  // option, or a per-college override map. Filed as a separate issue.
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🌴 CA Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "ca",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ CA Colleague scraper failed:", err);
  process.exit(1);
});
