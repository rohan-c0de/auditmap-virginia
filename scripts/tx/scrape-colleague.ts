/**
 * Texas — Colleague Self-Service scrape (2 colleges)
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for the
 * two TX community colleges discovered to run Ellucian Colleague behind
 * a separate self-service subdomain (the auto-add-state fingerprint
 * sweep only probed the colleges' primary domains and missed these):
 *
 *   amarillo-college  → acselfservice.actx.edu/Student/Courses
 *   odessa-college    → sserv.odessa.edu/Student/Courses
 *
 * Closes 2 of the 3 remaining colleges from issue #456 cluster #8
 * (TX shared form: Amarillo, Kilgore, Odessa — HCC already covered by
 * PR #460). Kilgore runs Jenzabar ICS at accesskc.kilgore.edu via a
 * non-standard AddDrop_Courses.jnz portlet URL — saved for a follow-up.
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "amarillo-college": "https://acselfservice.actx.edu",
  "odessa-college": "https://sserv.odessa.edu",
  // Added via coverage-expansion + refingerprint workflow:
  "college-of-the-mainland": "https://selfserve.com.edu",
  "mclennan-community-college": "https://mymcc.mclennan.edu",
  // galveston-college (gcsis-ssprod.gc.edu) and texas-southmost-college
  // (selfservice.tsc.edu) were wired here but never produced sections: both
  // Colleague instances render the catalog shell but gate live section/term
  // data behind login (galveston → Account/Login markers on the search page;
  // TSC → redirects to SSO at colss-prod.tscsaas.elluciancloud.com). Removed
  // from the active host map and recorded in documentedCeilings.courses.
  // Verified 2026-06.
  // TX Phase A — verified guest-open Colleague Self-Service hosts.
  "alvin-community-college": "https://self-service.alvincollege.edu",
  // Vernon was fingerprinted as Banner SSB but
  // www.vernoncollege.edu/StudentRegistrationSsb is the website's 404 page
  // served at HTTP 200, not a real Banner endpoint. The college's actual
  // SIS is Ellucian Colleague Cloud.
  "vernon-college": "https://vernon-ss.colleague.elluciancloud.com",
  // TX Phase D — Del Mar's actual SIS turned out to be Colleague at
  // colss-prod.ec.delmar.edu (Phase C had treated Del Mar as Coursedog-
  // only because that's where its catalog lives; the live class schedule
  // is a separate Colleague host the fingerprinter never probed).
  "del-mar-college": "https://colss-prod.ec.delmar.edu",
  // Austin CCD's selfservice.austincc.edu is auth-gated
  // (redirects /Student/Courses → /Account/Login) — but its public
  // www6.austincc.edu/schedule PHP app is scraped by scripts/tx/scrape-austin.ts.
  // Central Texas College's Colleague at student.ctcd.org is public but sits
  // behind Cloudflare Bot Management; the shared template's Playwright run does
  // not clear the managed challenge (0 terms discovered), so CTC is handled by
  // the bespoke stealth scraper scripts/tx/scrape-central-texas.ts instead.
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🤠 TX Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "tx",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ TX Colleague scraper failed:", err);
  process.exit(1);
});
