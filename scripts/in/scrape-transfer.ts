/**
 * scrape-transfer.ts — Indiana transfer equivalencies (Ivy Tech).
 *
 * Ivy Tech Community College (the single statewide system that is the only
 * Indiana community college we cover) is registered in CollegeTransfer.Net as
 * one aggregate institution (id 5) and publishes in-state equivalencies to
 * Indiana public universities (USI, IU campuses, Purdue, Ball State, Indiana
 * State, Vincennes, etc.). Source ID discovered via:
 *   Institutions?$filter=State eq 'Indiana'
 *
 * NOTE: richer per-receiver sources exist for Indiana (Purdue's Banner credit
 * guide, IU's CollegeSource TES public views). Those are tracked as a future
 * enhancement; this CT.Net pass establishes baseline coverage.
 *
 * Usage:
 *   npx tsx scripts/in/scrape-transfer.ts
 *   npx tsx scripts/in/scrape-transfer.ts --no-import
 */
import { scrapeCtnetState } from "../lib/scrape-ctnet-multisource.js";

const COLLEGES = [
  { slug: "ivy-tech-community-college", name: "Ivy Tech Community College", senderId: 5 },
];

scrapeCtnetState({
  stateName: "Indiana",
  slug: "in",
  colleges: COLLEGES,
  skipImport: process.argv.includes("--no-import"),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
