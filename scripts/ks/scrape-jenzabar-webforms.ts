/**
 * Kansas — Jenzabar ICS WebForms (Course_Schedule / Course_Search portlets)
 *
 * Thin wrapper around scripts/lib/scrape-jenzabar-webforms.ts for the
 * seven KS Jenzabar colleges discovered during the auto-add-state run.
 * The orchestrator's fingerprinter correctly identified jenzabar but
 * couldn't auto-locate the Course_Search portlet URL because each
 * college uses a non-standard subdomain (`icloud.`, `mycc.`, `conqs.`,
 * `my.`, `redzone.`, `web.`). URLs verified public-guest by the
 * untouchable-investigator agent.
 *
 *   cloud-county-community-college   → icloud.cloud.edu / Course_Search.jnz
 *   cowley-county-community-college  → mycc.cowley.edu  / Course_Search.jnz
 *   dodge-city-community-college     → conqs.dc3.edu    / Course_Search.jnz
 *   flint-hills-technical-college    → my.fhtc.edu      / Academics/Course_Schedule.jnz
 *   fort-scott-community-college     → my.fortscott.edu / Course_Schedule.jnz
 *   labette-community-college        → redzone.labette.edu / The_Red_Zone.jnz?portlet=Course_Schedules
 *   neosho-county-community-college  → web.neosho.edu   / Guest_Home.jnz?portlet=Course_Schedules
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-jenzabar-webforms.ts
 *   npx tsx scripts/ks/scrape-jenzabar-webforms.ts --college=dodge-city-community-college
 */
import { scrapeJenzabarWebformsState } from "../lib/scrape-jenzabar-webforms";

const HOSTS: Record<string, string> = {
  "cloud-county-community-college":
    "https://icloud.cloud.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "cowley-county-community-college":
    "https://mycc.cowley.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "dodge-city-community-college":
    "https://conqs.dc3.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "flint-hills-technical-college":
    "https://my.fhtc.edu/ICS/Academics/Course_Schedule.jnz?portlet=Course_Schedule&screen=Advanced+Course+Search&screenType=next",
  "fort-scott-community-college":
    "https://my.fortscott.edu/ICS/Course_Schedule.jnz?portlet=Course_Schedule&screen=Advanced+Course+Search&screenType=next",
  "labette-community-college":
    "https://redzone.labette.edu/ICS/The_Red_Zone.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next",
  "neosho-county-community-college":
    "https://web.neosho.edu/ICS/Guest_Home.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  await scrapeJenzabarWebformsState({
    state: "ks",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
