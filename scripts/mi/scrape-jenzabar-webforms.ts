/**
 * Michigan — Jenzabar WebForms (AddDrop_Courses portlet)
 *
 * Thin wrapper around the shared template at
 * scripts/lib/scrape-jenzabar-webforms.ts for North Central Michigan
 * College, the only MI Jenzabar college with a publicly-accessible
 * course-search portlet as of 2026-05-28.
 *
 * Investigated 5 MI Jenzabar candidates (bay-de-noc, gogebic, kirtland,
 * north-central-michigan, keweenaw-bay-ojibwa); only NCMC's
 * `pg0$V$ddlTerm` form renders without auth. The other 4 are split
 * between SAML auto-redirect (gogebic, kirtland) and "guest access
 * disabled" (bay-de-noc, kbocc) — both require credentials we don't
 * have.
 *
 * Endpoint verified to expose the WebForms term dropdown without auth:
 *   north-central-michigan-college  my.ncmich.edu  AddDrop_Courses
 *
 * Usage:
 *   npx tsx scripts/mi/scrape-jenzabar-webforms.ts
 *   npx tsx scripts/mi/scrape-jenzabar-webforms.ts --college=north-central-michigan-college
 */
import { scrapeJenzabarWebformsState } from "../lib/scrape-jenzabar-webforms";

const HOSTS: Record<string, string> = {
  "north-central-michigan-college":
    "https://my.ncmich.edu/ICS/Schedule.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  await scrapeJenzabarWebformsState({
    state: "mi",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
