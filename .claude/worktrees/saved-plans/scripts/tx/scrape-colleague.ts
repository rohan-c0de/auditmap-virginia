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
  "galveston-college": "https://gcsis-ssprod.gc.edu",
  "mclennan-community-college": "https://mymcc.mclennan.edu",
  "texas-southmost-college": "https://selfservice.tsc.edu",
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
  // (redirects /Student/Courses → /Account/Login). Deferred — needs an
  // alternate guest endpoint or catalog-only import.
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
