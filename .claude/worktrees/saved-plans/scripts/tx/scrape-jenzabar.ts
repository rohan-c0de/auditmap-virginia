/**
 * Texas — Jenzabar JICS (standard StudentRegistration portlet)
 *
 * Thin wrapper around the shared template at scripts/lib/scrape-jenzabar.ts
 * for TX Jenzabar colleges whose course search renders the standard
 * `StudentRegistrationPortlet_CourseSearchView` (the form built around
 * the `#stuRegTermSelect` term dropdown).
 *
 * URL discovery (verified to render `#stuRegTermSelect` without auth on
 * 2026-05-28; Panola smoke-tested successfully — 2,858 sections across 6
 * terms):
 *
 *   panola-college   pctportal.jenzabarcloud.com /ICS/Admin/Shared_Features/Everyone.jnz
 *
 * Two other TX colleges (hill-college, ranger-college) expose the same
 * Everyone.jnz URL with the view name as a navigation parameter, but the
 * portlet body itself is login-gated (no `#stuRegTermSelect` element in
 * the unauth response). They're deferred — would need credentials or a
 * different public entry point.
 *
 * The other 4 TX Jenzabar colleges (NCTC, NETCC, Paris Jr, Texarkana) use
 * different portlet variants (AddDrop_Courses / Course_Search WebForms and
 * Find_Courses Simple_Query) — those are covered by sibling scrapers, not
 * this one.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-jenzabar.ts
 *   npx tsx scripts/tx/scrape-jenzabar.ts --college=panola-college
 */
import { scrapeJenzabarState } from "../lib/scrape-jenzabar";

const SEARCH_QS =
  "?portlet=Student_Registration" +
  "&screen=StudentRegistrationPortlet_CourseSearchView" +
  "&screenType=next";

const HOSTS: Record<string, string> = {
  "panola-college":
    "https://pctportal.jenzabarcloud.com/ICS/Admin/Shared_Features/Everyone.jnz" +
    SEARCH_QS,
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  await scrapeJenzabarState({
    state: "tx",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
