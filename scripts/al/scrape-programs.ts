/**
 * scrape-programs.ts — degree/program requirements for AL.
 *
 * Seeded from scripts/lib/discover-programs.ts (probed each AL college's
 * catalog domain, derived from the Scorecard schoolUrl). Of 23 colleges, 9
 * CleanCatalog installs yield parseable programs and are scraped here; the
 * other 14 are deferred with reasons in data/al/DEFERRED-programs.md.
 *
 * Usage:
 *   npx tsx scripts/al/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";

const CATALOG_YEAR = "2025-2026";

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
    const outDir = path.join(process.cwd(), "data", "al", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

// The 9 CleanCatalog colleges whose /degrees index yields parseable program
// detail pages. 5 more discovered colleges yield nothing on the default crawl
// and are deferred — see data/al/DEFERRED-programs.md (coastal, trenholm,
// central-alabama: non-standard catalog structure; drake-state: SmartCatalogIQ
// URL unresolved; shelton-state: Acalog navoids needed).
const CLEANCATALOG: { slug: string; baseUrl: string; indexPaths?: string[] }[] = [
  { slug: "bevill-state-community-college", baseUrl: "https://catalog.bscc.edu" },
  { slug: "chattahoochee-valley-community-college", baseUrl: "https://catalog.cv.edu" },
  { slug: "gadsden-state-community-college", baseUrl: "https://catalog.gadsdenstate.edu" },
  { slug: "george-c-wallace-community-college-dothan", baseUrl: "https://catalog.wallace.edu" },
  { slug: "george-c-wallace-state-community-college-hanceville", baseUrl: "https://wallacestate.cleancatalog.net" },
  { slug: "george-c-wallace-state-community-college-selma", baseUrl: "https://catalog.wccs.edu" },
  { slug: "john-c-calhoun-state-community-college", baseUrl: "https://catalog.calhoun.edu" },
  { slug: "northwest-shoals-community-college", baseUrl: "https://catalog.nwscc.edu" },
  { slug: "southern-union-state-community-college", baseUrl: "https://catalog.suscc.edu" },
];

async function main() {
  console.log("AL program scraper");

  for (const c of CLEANCATALOG) {
    await run(c.slug, () =>
      scrapeCleanCatalogPrograms({
        collegeSlug: c.slug,
        baseUrl: c.baseUrl,
        catalogYear: CATALOG_YEAR,
        ...(c.indexPaths ? { indexPaths: c.indexPaths } : {}),
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
