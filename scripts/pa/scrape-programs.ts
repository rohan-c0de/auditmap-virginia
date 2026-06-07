/**
 * scrape-programs.ts — degree/program requirements for PA.
 *
 * Pennsylvania is the hardest state scouted: most colleges host catalogs at
 * non-discoverable URLs, and the two templated catalogs that DO resolve well
 * hit parser bugs. Currently scraped:
 *   Acalog (search_advanced discovery): CCAC (Allegheny/Pittsburgh), Reading Area
 *
 * Deferred (catalog found, parser returns 0 — a shared-parser fix would unlock
 * these, see [[reference_programs_scraping_playbook]]):
 *   - dccc (Delaware County, CourseLeaf): discovery finds 104 program paths but
 *     the detail parser extracts 0 (its requirement blocks differ).
 *   - northampton (Coursedog): finds 369 programs, parses 0 (the documented
 *     freeform / status-casing bug, same as SENMC).
 * Deferred (catalog not locatable): CCP (Philadelphia), HACC, Montgomery (mc3),
 * Bucks, and the rest.
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";

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
    const outDir = path.join(process.cwd(), "data", "pa", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("PA program scraper");

  for (const c of [
    { collegeSlug: "ccac", baseUrl: "https://catalog.ccac.edu" },
    { collegeSlug: "racc", baseUrl: "https://catalog.racc.edu" },
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
