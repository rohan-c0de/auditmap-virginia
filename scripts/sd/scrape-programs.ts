/**
 * scrape-programs.ts — degree/program requirements for SD.
 *
 * Coverage:
 * - Southeast Technical College — Acalog (catalog.southeasttech.edu,
 *   catoid=35, 2026-2027). Scraped via the shared Acalog template.
 *   NOT catalog.southeast.edu — that's a different "Southeast Community
 *   College" in Nebraska. The orchestrator's programs discovery in #701
 *   confused them; do not regress.
 *
 * Deferred (no template fit):
 * - Western Dakota Technical College — catalog is PDF only
 *   (wdt.edu/.../course-catalog-2025-26.pdf). The orchestrator's
 *   discovery flagged catalog.western.edu as a courseleaf hit, but
 *   that's a different "Western" institution, not WDT.
 * - Lake Area, Oglala Lakota, Sisseton-Wahpeton — no public templated
 *   programs catalog detected.
 * - Mitchell Technical College — Coursedog at catalog.mitchelltech.edu
 *   is course descriptions, not program-requirement structures; the
 *   raw dump lives at data/sd/coursedog-catalog/.
 *
 * Usage:
 *   npx tsx scripts/sd/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";

async function run(
  slug: string,
  scrape: () => Promise<{
    programs: unknown[];
    catalog_year: string;
    catalog_url: string;
    college_slug: string;
    scraped_at: string;
  }>,
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
    const outDir = path.join(process.cwd(), "data", "sd", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("SD program scraper");
  await run("southeast-technical-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "southeast-technical-college",
      baseUrl: "https://catalog.southeasttech.edu",
      catoidFallback: 35,
      programNavoids: [27253],
      autoDiscoverCatoid: true,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
