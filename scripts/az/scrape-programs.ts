/**
 * scrape-programs.ts — degree/certificate program requirements for AZ
 * community colleges.
 *
 * Active: 4 Acalog colleges. Program lists on these catalogs are JS-rendered,
 * so we discover them through search_advanced.php (useSearchDiscovery) — the
 * navoid auto-discovery finds 0 on these, which is why the 2026-05-24 seed
 * (navoids-only) produced no data.
 *
 *   pima      → catalog.pima.edu      (~100 programs)
 *   yavapai   → catalog.yc.edu        (~139)
 *   mohave    → catalog.mohave.edu    (~108)
 *   coconino  → catalog.coconino.edu  (~53)
 *
 * NOT scraped (no usable public program data — verified live 2026-06):
 *   - 10 Maricopa district colleges (chandler-gilbert, estrella-mountain,
 *     gateway, glendale, mesa, paradise-valley, phoenix, rio-salado,
 *     scottsdale, south-mountain): share one Coursedog catalog at
 *     catalog.maricopa.edu whose programs section is EMPTY ("Results (0) — No
 *     Programs Found"); the tenant (maricopa_peoplesoft_direct) is a
 *     courses-only PeopleSoft feed with no published degree requirements.
 *   - cochise (catalog.cochise.edu, Coursedog): catalog returns 0 programs.
 *   - eastern-arizona (catalog.eac.edu, Coursedog): 200 program shells, but
 *     none expose requirements in the requisitesSimple structure this scraper
 *     reads — nothing plannable.
 *   - central-arizona (catalog.centralaz.edu, Coursedog): 63 programs, but
 *     they list narrative requirements rather than course codes (only ~1 had
 *     >=5 real courses) — not plannable, so omitted.
 *   - arizona-western, northland-pioneer, dine, tohono-oodham: no public
 *     catalog on any supported platform.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-programs.ts
 *   npx tsx scripts/az/scrape-programs.ts --college pima-community-college
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";

const ACALOG: AcalogProgramConfig[] = [
  { collegeSlug: "pima-community-college", baseUrl: "https://catalog.pima.edu", catoidFallback: 17, programNavoids: [], autoDiscoverCatoid: true, useSearchDiscovery: true },
  { collegeSlug: "yavapai-college", baseUrl: "https://catalog.yc.edu", catoidFallback: 29, programNavoids: [], autoDiscoverCatoid: true, useSearchDiscovery: true },
  { collegeSlug: "mohave-community-college", baseUrl: "https://catalog.mohave.edu", catoidFallback: 71, programNavoids: [], autoDiscoverCatoid: true, useSearchDiscovery: true },
  { collegeSlug: "coconino-community-college", baseUrl: "https://catalog.coconino.edu", catoidFallback: 14, programNavoids: [], autoDiscoverCatoid: true, useSearchDiscovery: true },
];

async function run(
  slug: string,
  scrape: () => Promise<{ programs: unknown[]; catalog_year: string; catalog_url: string; college_slug: string; scraped_at: string }>,
): Promise<number> {
  console.log(`\n=== ${slug} ===`);
  try {
    const data = await scrape();
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug} (file not written).`);
      return 0;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs as never);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", "az", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
    return data.programs.length;
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
    return -1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--college");
  const only = flag >= 0 ? args[flag + 1] : null;

  console.log("AZ program scraper");
  const summary: { slug: string; programs: number }[] = [];

  for (const c of ACALOG) {
    if (only && c.collegeSlug !== only) continue;
    summary.push({ slug: c.collegeSlug, programs: await run(c.collegeSlug, () => scrapeAcalogPrograms(c)) });
  }

  console.log(`\n${"=".repeat(60)}\nDone. ${summary.filter((s) => s.programs > 0).length} college(s) with programs:`);
  for (const s of summary) console.log(`  ${s.slug}: ${s.programs < 0 ? "ERROR" : s.programs}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
