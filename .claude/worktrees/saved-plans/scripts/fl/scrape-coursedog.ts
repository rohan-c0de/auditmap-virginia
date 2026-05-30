/**
 * scrape-coursedog.ts (FL)
 *
 * Scrapes Coursedog catalog data for FL colleges that publish through
 * Coursedog. Currently covers FSCJ (Florida State College at Jacksonville),
 * which uses Workday for section registration (auth-gated) but Coursedog
 * for the public course catalog.
 *
 * Output: data/fl/coursedog-catalog/{slug}.json — used by the prereqs
 * aggregator and as a fallback course list for colleges without section data.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-coursedog.ts                  # all colleges
 *   npx tsx scripts/fl/scrape-coursedog.ts --college fscj   # one college
 */

import { scrapeCoursedogCatalog } from "../lib/scrape-coursedog";

const COURSEDOG_COLLEGES: Record<string, string> = {
  fscj: "catalog.fscj.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;

  const targets = collegeFilter
    ? { [collegeFilter]: COURSEDOG_COLLEGES[collegeFilter] }
    : COURSEDOG_COLLEGES;

  if (collegeFilter && !COURSEDOG_COLLEGES[collegeFilter]) {
    console.error(`Unknown college: ${collegeFilter}`);
    console.error(`Available: ${Object.keys(COURSEDOG_COLLEGES).join(", ")}`);
    process.exit(1);
  }

  let totalCourses = 0;

  for (const [slug, domain] of Object.entries(targets)) {
    console.log(`\n=== Scraping ${slug} (${domain}) ===`);
    const result = await scrapeCoursedogCatalog({
      state: "fl",
      slug,
      catalogDomain: domain,
    });
    if (result.error) {
      console.error(`  ERROR: ${result.error}`);
      continue;
    }
    totalCourses += result.coursesCount;
    console.log(
      `  ${slug}: ${result.coursesCount} courses (${result.withPrereqs} with prereqs)`
    );
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total: ${totalCourses} courses across ${Object.keys(targets).length} colleges`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
