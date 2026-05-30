/**
 * Massachusetts — Jenzabar WebForms (Course_Search portlet)
 *
 * Thin wrapper around the shared template at
 * scripts/lib/scrape-jenzabar-webforms.ts for Cape Cod Community College,
 * the only MA Jenzabar college with a publicly-accessible course-search
 * portlet as of 2026-05-28.
 *
 * Investigated 3 MA Jenzabar candidates (capecod, qcc, rcc); only Cape
 * Cod's `pg0$V$ddlTerm` form renders without auth. QCC sits behind
 * Jenzabar's "guest access disabled" permission flag (200 + empty
 * `#portlets` div); RCC fires a SAML auto-redirect before the portlet
 * loads. Both need credentials we don't have.
 *
 * Endpoint verified to expose the WebForms term dropdown without auth:
 *   cape-cod-community-college  campusweb.capecod.edu  Course_Search
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-jenzabar-webforms.ts
 *   npx tsx scripts/ma/scrape-jenzabar-webforms.ts --college=capecod
 */
import { scrapeJenzabarWebformsState } from "../lib/scrape-jenzabar-webforms";

const HOSTS: Record<string, string> = {
  capecod:
    "https://campusweb.capecod.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  await scrapeJenzabarWebformsState({
    state: "ma",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
