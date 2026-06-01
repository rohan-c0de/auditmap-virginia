/**
 * scrape-programs.ts — degree/program requirements for NE.
 *
 * Auto-discovered by scripts/lib/discover-programs.ts in #947, then
 * curated:
 *   - Southeast CC Area: Acalog at catalog.southeast.edu (catoid=22,
 *     navoids 2845 + 2750 → 163 programs)
 *   - Western Nebraska CC: Acalog at catalog.wncc.edu (catoid=6,
 *     navoids 346, 351, 353 → ~298 programs)
 *
 * Corrected from the auto-generated wrapper: Phase 6 discovery wrote
 * catalog.western.edu (Western Colorado University) for WNCC — a
 * false-positive from the slug-word heuristic. The real WNCC catalog
 * is catalog.wncc.edu, and it's Acalog (not Courseleaf).
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-programs.ts
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
    const outDir = path.join(process.cwd(), "data", "ne", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("NE program scraper");

  await run("southeast-community-college-area", () =>
    scrapeAcalogPrograms({
      collegeSlug: "southeast-community-college-area",
      baseUrl: "https://catalog.southeast.edu",
      catoidFallback: 22,
      programNavoids: [2845, 2750],
      autoDiscoverCatoid: true,
    }),
  );

  await run("western-nebraska-community-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "western-nebraska-community-college",
      baseUrl: "https://catalog.wncc.edu",
      catoidFallback: 6,
      programNavoids: [346, 351, 353],
      autoDiscoverCatoid: true,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
