/**
 * NY/SUNY — programs scrape for non-Acalog catalog platforms
 *
 * Covers SUNY CCs whose catalogs run on Clean Catalog, SmartCatalogIQ,
 * or CourseLeaf. Each section invokes the corresponding shared template
 * from scripts/lib/. Genesee CC is handled separately (custom WP JSON API).
 *
 * Coverage as of 2026-05-30:
 *
 *   Clean Catalog (Drupal 11):
 *     clinton-cc          → https://catalog.clinton.edu
 *     columbia-greene-cc  → https://catalog.columbiagreene.edu
 *     corning-cc          → https://corning.cleancatalog.net
 *
 *   SmartCatalogIQ:
 *     suny-adirondack     → https://sunyacc.smartcatalogiq.com  (year=25-26)
 *     finger-lakes-cc     → https://flcc.smartcatalogiq.com     (year=2025-2026)
 *     rockland-cc         → https://sunyrockland.smartcatalogiq.com (year=2025-2026)
 *
 *   CourseLeaf:
 *     fit                 → https://catalog.fitnyc.edu
 *
 * Other SUNY CCs use OmniUpdate (4), Lotus Notes (Monroe), TerminalFour (Cayuga),
 * PDF-only (FMCC/Schenectady/Sullivan), or have no public catalog. See
 * data/ny/_suny-catalog-fingerprint.md for the full table.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-suny-other-programs.ts
 *   npx tsx scripts/ny/scrape-suny-other-programs.ts --college=fit
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CleanCatalogProgramConfig } from "../lib/scrape-cleancatalog-programs.js";
import type { SmartCatalogIqProgramConfig } from "../lib/scrape-smartcatalogiq-programs.js";
import type { CourseleafProgramConfig } from "../lib/scrape-courseleaf-programs.js";

const CLEAN_CATALOG: CleanCatalogProgramConfig[] = [
  { collegeSlug: "clinton-cc", baseUrl: "https://catalog.clinton.edu", catalogYear: "2025-2026" },
  { collegeSlug: "columbia-greene-cc", baseUrl: "https://catalog.columbiagreene.edu", catalogYear: "2025-2026" },
  { collegeSlug: "corning-cc", baseUrl: "https://corning.cleancatalog.net", catalogYear: "2025-2026" },
];

const SCIQ: SmartCatalogIqProgramConfig[] = [
  {
    collegeSlug: "suny-adirondack",
    baseUrl: "https://sunyacc.smartcatalogiq.com",
    catalogYear: "25-26",
  },
  {
    collegeSlug: "finger-lakes-cc",
    baseUrl: "https://flcc.smartcatalogiq.com",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "rockland-cc",
    baseUrl: "https://sunyrockland.smartcatalogiq.com",
    catalogYear: "2025-2026",
  },
];

const COURSELEAF: CourseleafProgramConfig[] = [
  { collegeSlug: "fit", baseUrl: "https://catalog.fitnyc.edu" },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0 ? args[args.indexOf("--college") + 1] : null);

  const outDir = path.join(process.cwd(), "data", "ny", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  let totalPrograms = 0;
  let collegesAttempted = 0;

  // -- Clean Catalog batch --
  for (const cfg of CLEAN_CATALOG) {
    if (collegeArg && cfg.collegeSlug !== collegeArg) continue;
    collegesAttempted++;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Clean Catalog: ${cfg.collegeSlug} (${cfg.baseUrl})`);
    console.log("=".repeat(60));
    try {
      const data = await scrapeCleanCatalogPrograms(cfg);
      if (data.programs.length === 0) {
        console.log(`  No programs scraped for ${cfg.collegeSlug}.`);
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      const outPath = path.join(outDir, `${cfg.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR ${cfg.collegeSlug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // -- SmartCatalogIQ batch --
  for (const cfg of SCIQ) {
    if (collegeArg && cfg.collegeSlug !== collegeArg) continue;
    collegesAttempted++;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`SmartCatalogIQ: ${cfg.collegeSlug} (${cfg.baseUrl})`);
    console.log("=".repeat(60));
    try {
      const data = await scrapeSmartCatalogIqPrograms(cfg);
      if (data.programs.length === 0) {
        console.log(`  No programs scraped for ${cfg.collegeSlug}.`);
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      const outPath = path.join(outDir, `${cfg.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR ${cfg.collegeSlug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // -- CourseLeaf batch --
  for (const cfg of COURSELEAF) {
    if (collegeArg && cfg.collegeSlug !== collegeArg) continue;
    collegesAttempted++;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CourseLeaf: ${cfg.collegeSlug} (${cfg.baseUrl})`);
    console.log("=".repeat(60));
    try {
      const data = await scrapeCourseleafPrograms(cfg);
      if (data.programs.length === 0) {
        console.log(`  No programs scraped for ${cfg.collegeSlug}.`);
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      const outPath = path.join(outDir, `${cfg.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR ${cfg.collegeSlug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. ${totalPrograms} programs across ${collegesAttempted} college(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
