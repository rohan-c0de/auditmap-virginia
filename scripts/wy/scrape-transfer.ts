/**
 * scrape-transfer.ts — Wyoming transfer equivalencies.
 *
 * All 7 Wyoming community colleges are registered in CollegeTransfer.Net and
 * publish dense in-state equivalencies (primarily → University of Wyoming, plus
 * inter-community-college articulation). Source IDs discovered via:
 *   Institutions?$filter=State eq 'Wyoming'
 *
 * Usage:
 *   npx tsx scripts/wy/scrape-transfer.ts
 *   npx tsx scripts/wy/scrape-transfer.ts --no-import
 */
import { scrapeCtnetState } from "../lib/scrape-ctnet-multisource.js";

const COLLEGES = [
  { slug: "casper-college", name: "Casper College", senderId: 2753 },
  { slug: "central-wyoming-college", name: "Central Wyoming College", senderId: 2441 },
  { slug: "eastern-wyoming-college", name: "Eastern Wyoming College", senderId: 3099 },
  { slug: "laramie-county-community-college", name: "Laramie County Community College", senderId: 2110 },
  { slug: "northern-wyoming-community-college-district", name: "Northern Wyoming Community College District", senderId: 2754 },
  { slug: "northwest-college", name: "Northwest College", senderId: 2111 },
  { slug: "western-wyoming-community-college", name: "Western Wyoming Community College", senderId: 2112 },
];

scrapeCtnetState({
  stateName: "Wyoming",
  slug: "wy",
  colleges: COLLEGES,
  skipImport: process.argv.includes("--no-import"),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
