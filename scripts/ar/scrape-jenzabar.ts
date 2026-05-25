/**
 * Arkansas — Jenzabar Course_Search.jnz multi-college scraper.
 *
 * One college: East Arkansas Community College. The orchestrator's
 * fingerprint correctly identified the platform as Jenzabar JICS but
 * couldn't auto-discover the portlet query string — EACC's search lives
 * at `/ICS/Course_Search.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search`
 * (verified publicly accessible without login).
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-jenzabar.ts                         # all (currently 1)
 *   npx tsx scripts/ar/scrape-jenzabar.ts --college east-arkansas-community-college
 */
import { scrapeJenzabarState } from "../lib/scrape-jenzabar";

const JENZABAR_COLLEGES: Record<string, string> = {
  "east-arkansas-community-college":
    "https://my.eacc.edu/ICS/Course_Search.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  await scrapeJenzabarState({
    state: "ar",
    hosts: JENZABAR_COLLEGES,
    collegeFilter,
    noImport,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
