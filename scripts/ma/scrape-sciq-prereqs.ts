/**
 * scrape-sciq-prereqs.ts — MA SmartCatalogIQ prereq scraper.
 *
 * Covers berkshire, necc, northshore. Each writes to data/ma/prereqs.json
 * (merged additively with existing entries).
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-sciq-prereqs.ts
 *   npx tsx scripts/ma/scrape-sciq-prereqs.ts --college berkshire
 */

import {
  scrapeAndMergeSciq,
  type SciqConfig,
} from "../lib/scrape-smartcatalogiq-prereqs.js";

const COLLEGES: SciqConfig[] = [
  {
    collegeSlug: "berkshire",
    state: "ma",
    subdomain: "berkshirecc",
    year: "2024-2025",
    catalogPath: "catalog",
    coursesPath: "courses",
  },
  {
    collegeSlug: "necc",
    state: "ma",
    subdomain: "necc",
    year: "2026-2027",
    catalogPath: "catalog",
    coursesPath: "courses",
  },
  {
    collegeSlug: "northshore",
    state: "ma",
    subdomain: "northshore",
    year: "2025-2026",
    catalogPath: "college-catalog",
    coursesPath: "course-description",
  },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter =
    collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;

  const targets = collegeFilter
    ? COLLEGES.filter((c) => c.collegeSlug === collegeFilter)
    : COLLEGES;
  if (targets.length === 0) {
    console.error(
      `Unknown college: ${collegeFilter}. Available: ${COLLEGES.map((c) => c.collegeSlug).join(", ")}`,
    );
    process.exit(1);
  }

  await scrapeAndMergeSciq("ma", targets);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
