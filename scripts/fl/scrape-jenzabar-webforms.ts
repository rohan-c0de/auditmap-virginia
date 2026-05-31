/**
 * Florida — Jenzabar ICS WebForms (Course_Schedule portlet)
 *
 * Thin wrapper around scripts/lib/scrape-jenzabar-webforms.ts for the
 * FL Jenzabar colleges that expose a public Advanced Course Search
 * without SSO — currently only Chipola College.
 *
 * Chipola's portlet URL:
 *   https://my.chipola.edu/ICS/Portal_Homepage.jnz?portlet=Course_Schedule&screen=Advanced+Course+Search&screenType=next
 *
 * Chipola uses the same `pg0$V$ddlTerm` / `pg0$V$btnSearch` WebForms
 * pattern as the TX/MI/MA colleges — only the portlet name differs
 * (Course_Schedule vs AddDrop_Courses). The shared template handles
 * both portlet names identically since it selects by field id, not URL.
 *
 * Term value format is `YYYY;SS[;X]` where SS=10(FA)/20(SP)/30(SU)
 * and the optional X suffix is a sub-session. We target the
 * non-suffixed "full term" values to avoid duplication.
 *
 * Chipola's JICS keeps persistent background connections, so the
 * template's `networkidle` wait would normally hang. The template
 * now falls back to `domcontentloaded` when networkidle times out,
 * unblocking Chipola without touching other colleges.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-jenzabar-webforms.ts
 *   npx tsx scripts/fl/scrape-jenzabar-webforms.ts --college=chipola
 */
import { scrapeJenzabarWebformsState } from "../lib/scrape-jenzabar-webforms";

const HOSTS: Record<string, string> = {
  chipola:
    "https://my.chipola.edu/ICS/Portal_Homepage.jnz?portlet=Course_Schedule&screen=Advanced+Course+Search&screenType=next",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  await scrapeJenzabarWebformsState({
    state: "fl",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
