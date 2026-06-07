/**
 * scrape-programs.ts — degree/program requirements for MO.
 *
 * Missouri community colleges with a scrapeable templated catalog:
 *   Acalog (search_advanced discovery): St. Charles
 *   CourseLeaf: St. Louis CC (the biggest, program index at /programs/)
 * Deferred: Ozarks Technical (Acalog catoid=25 but search_advanced lists 0
 * programs — structure differs); Metropolitan CC–Kansas City (SmartCatalogIQ,
 * but the catalog year/path isn't auto-discoverable from its JS-rendered root);
 * the other ~9 colleges use custom / unresolved catalogs.
 *
 * Usage:
 *   npx tsx scripts/mo/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";

async function run(
  slug: string,
  scrape: () => Promise<{ programs: unknown[]; catalog_year: string; catalog_url: string; college_slug: string; scraped_at: string }>,
): Promise<void> {
  console.log(`\n=== ${slug} ===`);
  try {
    const data = await scrape();
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug}.`);
      return;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs as never);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", "mo", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("MO program scraper");

  // Acalog (program lists JS-rendered → search_advanced discovery)
  for (const c of [
    { collegeSlug: "st-charles-community-college", baseUrl: "https://catalog.stchas.edu" },
  ]) {
    await run(c.collegeSlug, () =>
      scrapeAcalogPrograms({
        collegeSlug: c.collegeSlug,
        baseUrl: c.baseUrl,
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
      }),
    );
  }

  // CourseLeaf (St. Louis CC — program index at /programs/)
  await run("saint-louis-community-college", () =>
    scrapeCourseleafPrograms({
      collegeSlug: "saint-louis-community-college",
      baseUrl: "https://catalog.stlcc.edu",
      programIndexPath: "/programs/",
    }),
  );

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
