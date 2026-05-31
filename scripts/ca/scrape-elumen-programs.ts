/**
 * CA — programs scraper for California CCs on eLumen catalogs.
 *
 * Wraps scripts/lib/scrape-elumen-programs.ts with per-tenant configs.
 *
 * Coverage as of 2026-05-30 (12 published of 28 eLumen CCs probed):
 *
 *   Published & scrapable (12): marin, redwoods, ccc (Contra Costa), dvc,
 *     deanza, mjc, sccollege (Santiago Canyon), mission, avc, bakersfield,
 *     glendale, ltcc.
 *
 *   Not published / 404 (12, mostly LACCD): all 9 LACCD colleges (lacc,
 *     elac, lahc, lasc, lattc, lavc, lamission, pierce, wlac) + yc (Yuba)
 *     + westvalley — catalogs configured but not yet published.
 *
 *   Server-error / different API contract (4): lmc, gocolumbia, pvc,
 *     siskiyous — return 500 on root publish endpoint and 404 on direct
 *     year/page lookup. Deferred.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-elumen-programs.ts
 *   npx tsx scripts/ca/scrape-elumen-programs.ts --college=college-of-marin
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeElumenPrograms } from "../lib/scrape-elumen-programs.js";
import type { ElumenProgramConfig } from "../lib/scrape-elumen-programs.js";

const COLLEGES: ElumenProgramConfig[] = [
  // Catalog year probed via API barUrl on 2026-05-30
  { collegeSlug: "college-of-marin", tenant: "marin.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "college-of-the-redwoods", tenant: "redwoods.elumenapp.com", catalogYear: "2025-2026" },
  { collegeSlug: "contra-costa-college", tenant: "ccc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "diablo-valley-college", tenant: "dvc.elumenapp.com", catalogYear: "DVC2025-2026Catalog" },
  { collegeSlug: "de-anza-college", tenant: "deanza.elumenapp.com", catalogYear: "2025-2026" },
  { collegeSlug: "modesto-junior-college", tenant: "mjc.elumenapp.com", catalogYear: "2026-2027" },
  { collegeSlug: "santiago-canyon-college", tenant: "sccollege.elumenapp.com", catalogYear: "catalog" },
  { collegeSlug: "mission-college", tenant: "mission.elumenapp.com", catalogYear: "24-25" },
  { collegeSlug: "antelope-valley-community-college-district", tenant: "avc.elumenapp.com", catalogYear: "2025-26" },
  { collegeSlug: "bakersfield-college", tenant: "bakersfield.elumenapp.com", catalogYear: "2022-2023" },
  { collegeSlug: "glendale-community-college", tenant: "glendale.elumenapp.com", catalogYear: "GCC-2025-2026" },
  { collegeSlug: "lake-tahoe-community-college", tenant: "ltcc.elumenapp.com", catalogYear: "2026-2027" },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg = args.find((a) => a.startsWith("--college="))?.split("=")[1];

  const outDir = path.join(process.cwd(), "data", "ca", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  const targets = collegeArg
    ? COLLEGES.filter((c) => c.collegeSlug === collegeArg)
    : COLLEGES;

  if (targets.length === 0) {
    console.error(`Unknown college: ${collegeArg}`);
    process.exit(1);
  }

  console.log(`CA eLumen programs scraper — ${targets.length} college(s)\n`);

  let totalPrograms = 0;
  let succeeded = 0;
  for (const cfg of targets) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`eLumen: ${cfg.collegeSlug} (${cfg.tenant})`);
    console.log("=".repeat(60));
    try {
      const data = await scrapeElumenPrograms(cfg);
      if (data.programs.length === 0) {
        console.log(`  No programs scraped for ${cfg.collegeSlug}.`);
        continue;
      }
      const outPath = path.join(outDir, `${cfg.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
      totalPrograms += data.programs.length;
      succeeded++;
    } catch (e) {
      console.error(`  ERROR ${cfg.collegeSlug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. ${totalPrograms} programs from ${succeeded}/${targets.length} colleges.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
