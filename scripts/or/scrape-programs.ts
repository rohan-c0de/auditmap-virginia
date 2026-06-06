/**
 * scrape-programs.ts — degree/program requirements for OR.
 *
 * Oregon community colleges with a scrapeable templated catalog:
 *   Acalog (program lists JS-rendered → search_advanced discovery):
 *     Chemeketa, Rogue, Klamath
 *   Courseleaf: Portland CC (program index at /programsanddisciplines/, not
 *     the default /programs-study/)
 * Deferred: Mt. Hood, Clackamas, Central Oregon are CourseLeaf too but their
 * program index lives at a non-default path still to be identified; the other
 * ~9 colleges use custom / non-templated catalogs.
 *
 * Usage:
 *   npx tsx scripts/or/scrape-programs.ts
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
    const outDir = path.join(process.cwd(), "data", "or", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

const ACALOG: { collegeSlug: string; baseUrl: string }[] = [
  { collegeSlug: "chemeketa-community-college", baseUrl: "https://catalog.chemeketa.edu" },
  { collegeSlug: "rogue-community-college", baseUrl: "https://catalog.roguecc.edu" },
  { collegeSlug: "klamath-community-college", baseUrl: "https://catalog.klamathcc.edu" },
];

const COURSELEAF: { collegeSlug: string; baseUrl: string; programIndexPath: string }[] = [
  { collegeSlug: "portland-community-college", baseUrl: "https://catalog.pcc.edu", programIndexPath: "/programsanddisciplines/" },
];

async function main() {
  console.log("OR program scraper");

  for (const c of ACALOG) {
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

  for (const c of COURSELEAF) {
    await run(c.collegeSlug, () =>
      scrapeCourseleafPrograms({ collegeSlug: c.collegeSlug, baseUrl: c.baseUrl, programIndexPath: c.programIndexPath }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
