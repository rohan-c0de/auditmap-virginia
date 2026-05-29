/**
 * scrape-coursedog.ts (LA)
 *
 * Scrapes the Coursedog catalog for Northshore Technical Community College —
 * the 12th LCTCS member, and the only one not on the shared Banner SSB 9
 * host at reg-prod.ec.lctcs.edu.
 *
 * Northshore has no public class-section endpoint (its registration sits
 * behind LoLA SSO), but its Coursedog catalog publishes 653 course
 * descriptions and prerequisite text. The aggregate-prereqs script walks
 * data/la/coursedog-catalog/*.json and merges those entries into
 * data/la/prereqs.json so they show up in the semester planner.
 *
 * Tenant: northshoretechcc_banner (extracted by Playwright session capture
 *   from catalog.northshorecollege.edu's network traffic on page load).
 *
 * Usage:
 *   npx tsx scripts/la/scrape-coursedog.ts
 *   npx tsx scripts/la/scrape-coursedog.ts --college northshore-technical-community-college
 */

import { scrapeCoursedogCatalog } from "../lib/scrape-coursedog";

const COURSEDOG_COLLEGES: Record<string, string> = {
  "northshore-technical-community-college": "catalog.northshorecollege.edu",
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
  let totalWithPrereqs = 0;

  for (const [slug, domain] of Object.entries(targets)) {
    console.log(`\n=== Scraping ${slug} (${domain}) ===`);
    const result = await scrapeCoursedogCatalog({
      state: "la",
      slug,
      catalogDomain: domain,
    });
    if (result.error) {
      console.error(`  ERROR: ${result.error}`);
      continue;
    }
    totalCourses += result.coursesCount;
    totalWithPrereqs += result.withPrereqs;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total: ${totalCourses} courses, ${totalWithPrereqs} with prereqs`);
}

main().catch((err) => {
  console.error("❌ LA Coursedog scrape failed:", err);
  process.exit(1);
});
