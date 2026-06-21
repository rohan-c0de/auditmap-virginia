/**
 * scrape-programs.ts — degree/program requirements for Wyoming.
 *
 * WY has 7 community colleges across two catalog platforms:
 *   - laramie-county-community-college           → Acalog (catalog.lccc.wy.edu)
 *   - casper-college                             → Acalog (catalog.caspercollege.edu)
 *   - western-wyoming-community-college          → Acalog (catalog.westernwyoming.edu)
 *   - northern-wyoming-community-college-district → Acalog (catalog.sheridan.edu)
 *   - northwest-college                          → Acalog (catalog.nwc.edu)
 *   - eastern-wyoming-college                    → Acalog (catalog.ewc.wy.edu)
 *   - central-wyoming-college                    → SmartCatalogIQ (cwc.smartcatalogiq.com)
 *
 * Each Acalog caller auto-discovers the current catoid + program navoids at
 * runtime, so the script stays correct when colleges roll over to a new
 * catalog year. CatoidFallback covers cases where dropdown probing fails.
 *
 * Output filename MUST equal the institution college_slug (slug-align gotcha).
 *
 * Usage:
 *   npx tsx scripts/wy/scrape-programs.ts                     # all colleges
 *   npx tsx scripts/wy/scrape-programs.ts --college casper-college
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import {
  scrapeAcalogPrograms,
  discoverProgramNavoids,
} from "../lib/scrape-acalog-programs.js";
import { discoverAcalogCatoid } from "../lib/discover-catalog.js";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";

type Result = {
  programs: unknown[];
  catalog_year: string;
  catalog_url: string;
  college_slug: string;
  scraped_at: string;
};

async function writeOut(slug: string, data: Result): Promise<number> {
  if (!data.programs || data.programs.length === 0) {
    console.log(`  ${slug}: 0 programs — not writing (left untouched)`);
    return 0;
  }
  const { matched, unmatched } = applyProgramMatching(data.programs as never);
  console.log(`  ${slug}: matcher ${matched} matched / ${unmatched} unmatched`);
  const outDir = path.join(process.cwd(), "data", "wy", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${slug}.json`),
    JSON.stringify(data, null, 2),
  );
  console.log(`  ✓ ${slug}: ${data.programs.length} programs`);
  return data.programs.length;
}

/**
 * Acalog runner that auto-discovers catoid + program navoids per call.
 * If navoid discovery turns up nothing, falls back to search-based program
 * discovery (search_advanced.php), which works on a handful of catalogs that
 * don't expose a flat nav.
 */
async function scrapeWyAcalog(
  collegeSlug: string,
  baseUrl: string,
  catoidFallback: number,
  usePlaywright = false,
): Promise<Result> {
  // catoid + navoid discovery uses plain fetch — skip for Playwright-only
  // catalogs (the scraper itself will handle the WAF/TLS path).
  let catoid = catoidFallback;
  let navoids: number[] = [];
  if (!usePlaywright) {
    catoid = await discoverAcalogCatoid(baseUrl, catoidFallback);
    navoids = await discoverProgramNavoids(baseUrl, catoid);
  }
  console.log(`  [${collegeSlug}] using catoid=${catoid}`);
  console.log(
    `  [${collegeSlug}] discovered ${navoids.length} program navoid(s): ${navoids.join(", ") || "(none)"}`,
  );
  return scrapeAcalogPrograms({
    collegeSlug,
    baseUrl,
    catoidFallback: catoid,
    programNavoids: navoids,
    autoDiscoverCatoid: usePlaywright, // let the scraper rediscover via Chromium
    useSearchDiscovery: navoids.length === 0,
    usePlaywright,
  });
}

const RUNNERS: Record<string, () => Promise<Result>> = {
  // catalog.lccc.wy.edu has an incomplete TLS chain
  // (UNABLE_TO_VERIFY_LEAF_SIGNATURE on Node fetch); Chromium tolerates it,
  // so route through Playwright. Same workaround as ID's CEI.
  "laramie-county-community-college": () =>
    scrapeWyAcalog(
      "laramie-county-community-college",
      "https://catalog.lccc.wy.edu",
      12,
      true,
    ),
  "casper-college": () =>
    scrapeWyAcalog(
      "casper-college",
      "https://catalog.caspercollege.edu",
      27,
    ),
  "western-wyoming-community-college": () =>
    scrapeWyAcalog(
      "western-wyoming-community-college",
      "https://catalog.westernwyoming.edu",
      11,
    ),
  "northern-wyoming-community-college-district": () =>
    scrapeWyAcalog(
      "northern-wyoming-community-college-district",
      "https://catalog.sheridan.edu",
      28,
    ),
  "northwest-college": () =>
    scrapeWyAcalog("northwest-college", "https://catalog.nwc.edu", 20),
  "eastern-wyoming-college": () =>
    scrapeWyAcalog(
      "eastern-wyoming-college",
      "https://catalog.ewc.wy.edu",
      9,
    ),
  // CWC runs SmartCatalogIQ at cwc.smartcatalogiq.com. The 2026-2027 catalog
  // exposes program pages under /catalog/programs-of-study/ (lowercase).
  "central-wyoming-college": () =>
    scrapeSmartCatalogIqPrograms({
      collegeSlug: "central-wyoming-college",
      baseUrl: "https://cwc.smartcatalogiq.com",
      catalogYear: "2026-2027",
      catalogPath: "catalog",
      programsPath: "programs-of-study",
    }),
};

async function main() {
  const i = process.argv.indexOf("--college");
  const only = i >= 0 ? process.argv[i + 1] : null;
  console.log("WY program scraper");
  let total = 0;
  for (const [slug, run] of Object.entries(RUNNERS)) {
    if (only && slug !== only) continue;
    console.log(`\n=== ${slug} ===`);
    try {
      total += await writeOut(slug, await run());
    } catch (e) {
      console.error(`  ✗ ${slug} failed: ${e}`);
    }
  }
  console.log(`\nTotal: ${total} programs across WY`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
