/**
 * scrape-transfer.ts — Alaska transfer equivalencies.
 *
 * Iḷisaġvik College (Alaska's only tribal college and the sole standalone
 * 2-year college we cover) publishes its equivalencies to the University of
 * Alaska system in CollegeTransfer.Net. Source ID discovered via:
 *   Institutions?$filter=State eq 'Alaska'
 *
 * Coverage is necessarily narrow (one sending college; the rest of Alaska's
 * 2-year education is delivered inside UAA/UAF/UAS community campuses we don't
 * track as separate institutions), but the Iḷisaġvik → UAA mappings are real.
 *
 * Usage:
 *   npx tsx scripts/ak/scrape-transfer.ts
 *   npx tsx scripts/ak/scrape-transfer.ts --no-import
 */
import { scrapeCtnetState } from "../lib/scrape-ctnet-multisource.js";

const COLLEGES = [
  { slug: "ilisagvik-college", name: "Iḷisaġvik College", senderId: 2491 },
];

scrapeCtnetState({
  stateName: "Alaska",
  slug: "ak",
  colleges: COLLEGES,
  skipImport: process.argv.includes("--no-import"),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
