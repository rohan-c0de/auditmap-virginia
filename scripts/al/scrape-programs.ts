/**
 * scrape-programs.ts — degree/program requirements for AL.
 *
 * Seeded from scripts/lib/discover-programs.ts (probed each AL college's
 * catalog domain, derived from the Scorecard schoolUrl). 14 of 23 colleges
 * are scraped here across three catalog platforms:
 *   • CleanCatalog (12): bevill, chattahoochee-valley, gadsden, wallace-dothan,
 *     wallace-hanceville, wallace-selma, calhoun, northwest-shoals,
 *     southern-union + coastal, trenholm, central-alabama (added 2026-06).
 *   • Acalog (1): shelton-state — catalog behind AWS WAF (202 challenge), so
 *     scraped via Playwright (usePlaywright); programs under navoid=574.
 *   • SmartCatalogIQ (1): drake-state — programs resolve via the broader
 *     catalog-root BFS fallback.
 * The other 9 colleges expose no templated public catalog — see
 * data/al/DEFERRED-programs.md.
 *
 * Usage:
 *   npx tsx scripts/al/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";

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

// The 12 CleanCatalog colleges whose index yields parseable program detail
// pages. The first 9 use the default /degrees index; the last 3 (added
// 2026-06) use the generalized parser (Trenholm's 4-segment /degrees/{div}/
// {code}/{slug} shape, Central Alabama's 3-segment non-standard credential
// segments, Coastal's division-landing-page index since its /degrees is a
// JS-driven search form).
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
  // Coastal's /degrees is a JS-driven Views search form (no server-rendered
  // links); its two division landing pages list every program server-side.
  {
    slug: "coastal-alabama-community-college",
    baseUrl: "https://catalog.coastalalabama.edu",
    indexPaths: [
      "/academic-transfer-instruction",
      "/career-and-technical-instruction",
    ],
  },
  { slug: "h-councill-trenholm-state-community-college", baseUrl: "https://catalog.trenholmstate.edu" },
  { slug: "central-alabama-community-college", baseUrl: "https://live-central-alabama.cleancatalog.io" },
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

  // Shelton State — Acalog at catalog.sheltonstate.edu, behind AWS WAF
  // (content.php returns HTTP 202 + empty body on plain fetch). Playwright
  // solves the JS challenge; programs are listed under navoid=574
  // ("Degrees and Certificates").
  await run("shelton-state-community-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "shelton-state-community-college",
      baseUrl: "https://catalog.sheltonstate.edu",
      catoidFallback: 21,
      programNavoids: [574],
      autoDiscoverCatoid: true,
      usePlaywright: true,
    }),
  );

  // Drake State — SmartCatalogIQ at drakestate.smartcatalogiq.com. Program
  // detail pages live in a sibling tree outside /programs-of-study/, so the
  // template's broader catalog-root BFS fallback resolves them.
  await run("j-f-drake-state-community-and-technical-college", () =>
    scrapeSmartCatalogIqPrograms({
      collegeSlug: "j-f-drake-state-community-and-technical-college",
      baseUrl: "https://drakestate.smartcatalogiq.com",
      catalogPath: "college-catalog",
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
