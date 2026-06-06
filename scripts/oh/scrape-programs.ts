/**
 * scrape-programs.ts — degree/program requirements for OH.
 *
 * Ohio community colleges with a scrapeable templated catalog:
 *   Acalog (search_advanced discovery): Sinclair, Owens
 *   CourseLeaf (per-college program index path — none use the default
 *     /programs-study/): Cuyahoga (Tri-C, /programs/), Lakeland
 *     (/degree-certificate-programs/), Rhodes State (/programs/)
 * Deferred: Columbus State + Cincinnati State are CourseLeaf but neither
 * /programs/ nor /azindex/ yields program detail links (structure differs,
 * needs investigation); Stark State is AWS-WAF gated (202); the rest use
 * custom / non-templated catalogs.
 *
 * Usage:
 *   npx tsx scripts/oh/scrape-programs.ts
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
    const outDir = path.join(process.cwd(), "data", "oh", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

const ACALOG: { collegeSlug: string; baseUrl: string }[] = [
  { collegeSlug: "sinclair-community-college", baseUrl: "https://catalog.sinclair.edu" },
  { collegeSlug: "owens-community-college", baseUrl: "https://catalog.owens.edu" },
];

const COURSELEAF: { collegeSlug: string; baseUrl: string; programIndexPath: string }[] = [
  { collegeSlug: "cuyahoga-community-college-district", baseUrl: "https://catalog.tri-c.edu", programIndexPath: "/programs/" },
  { collegeSlug: "lakeland-community-college", baseUrl: "https://catalog.lakelandcc.edu", programIndexPath: "/degree-certificate-programs/" },
  { collegeSlug: "james-a-rhodes-state-college", baseUrl: "https://catalog.rhodesstate.edu", programIndexPath: "/programs/" },
];

async function main() {
  console.log("OH program scraper");

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
