/**
 * scrape-sciq-prereqs.ts — NY SUNY SmartCatalogIQ prereq scraper.
 *
 * Covers suny-adirondack and rockland-cc. (FLCC's smartcatalogiq tenant
 * exists but doesn't have a published 2025-2026 college catalog — defer.)
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-sciq-prereqs.ts
 *   npx tsx scripts/ny/scrape-sciq-prereqs.ts --college rockland-cc
 */

import {
  scrapeAndMergeSciq,
  type SciqConfig,
} from "../lib/scrape-smartcatalogiq-prereqs.js";

const COLLEGES: SciqConfig[] = [
  {
    collegeSlug: "suny-adirondack",
    state: "ny",
    subdomain: "sunyacc",
    year: "24-25",
    catalogPath: "college-catalog",
    coursesPath: "courses",
  },
  {
    collegeSlug: "rockland-cc",
    state: "ny",
    subdomain: "sunyrockland",
    year: "2025-2026",
    catalogPath: "catalog",
    coursesPath: "courses",
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

  await scrapeAndMergeSciq("ny", targets);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
