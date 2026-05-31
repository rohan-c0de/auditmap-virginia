/**
 * CA — programs scraper for the 30 California CCs on eLumen catalogs.
 *
 * Wraps scripts/lib/scrape-elumen-programs.ts with per-tenant configs.
 *
 * Coverage (30 tenants discovered 2026-05-30):
 *   LACCD (9): lacc, elac, lahc, lasc, lattc, lavc, lamission, pierce, wlac
 *   4CD (3):   ccc (Contra Costa), dvc (Diablo Valley), lmc (Los Medanos)
 *   FHDA (1):  deanza  (Foothill on CourseLeaf, separate)
 *   YCCD (1):  yc (Yuba)
 *   NOCCCD (1): sccollege (Santiago Canyon)
 *   Yosemite (1): gocolumbia
 *   SJECCD (1): mission (San Jose-Evergreen CCD)
 *   Independents (13): antelope-valley (avc), bakersfield, modesto (mjc),
 *     glendale, redwoods, lake-tahoe (ltcc), palo-verde (pvc),
 *     siskiyous, west-valley, marin, redwoods, others.
 *
 * Each tenant has its own catalog year segment ("current", "2025-2026",
 * "24-25", etc).
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-elumen-programs.ts
 *   npx tsx scripts/ca/scrape-elumen-programs.ts --college=marin-college
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeElumenPrograms } from "../lib/scrape-elumen-programs.js";
import type { ElumenProgramConfig } from "../lib/scrape-elumen-programs.js";

const COLLEGES: ElumenProgramConfig[] = [
  // LACCD cluster (all 9 colleges; each tenant uses its own short subdomain)
  { collegeSlug: "los-angeles-city-college", tenant: "lacc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "east-los-angeles-college", tenant: "elac.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "los-angeles-harbor-college", tenant: "lahc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "los-angeles-southwest-college", tenant: "lasc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "los-angeles-trade-technical-college", tenant: "lattc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "los-angeles-valley-college", tenant: "lavc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "los-angeles-mission-college", tenant: "lamission.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "los-angeles-pierce-college", tenant: "pierce.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "west-los-angeles-college", tenant: "wlac.elumenapp.com", catalogYear: "current" },

  // 4CD (Contra Costa CCD) — 3 colleges; documented year "25-26" or "current"
  { collegeSlug: "contra-costa-college", tenant: "ccc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "diablo-valley-college", tenant: "dvc.elumenapp.com", catalogYear: "DVC2025-2026Catalog" },
  { collegeSlug: "los-medanos-college", tenant: "lmc.elumenapp.com", catalogYear: "25-26" },

  // Foothill-DeAnza CCD (Foothill is on CourseLeaf, separate)
  { collegeSlug: "de-anza-college", tenant: "deanza.elumenapp.com", catalogYear: "2025-2026" },

  // Yosemite CCD — 2 colleges
  { collegeSlug: "modesto-junior-college", tenant: "mjc.elumenapp.com", catalogYear: "2026-2027" },
  { collegeSlug: "columbia-college", tenant: "gocolumbia.elumenapp.com", catalogYear: "2026-2027-Catalog" },

  // NOCCCD — Santiago Canyon (Cypress + Fullerton are on CourseLeaf)
  { collegeSlug: "santiago-canyon-college", tenant: "sccollege.elumenapp.com", catalogYear: "current" },

  // SJECCD — Mission (Evergreen Valley is on CourseLeaf)
  { collegeSlug: "mission-college", tenant: "mission.elumenapp.com", catalogYear: "24-25" },

  // YCCD — Yuba
  { collegeSlug: "yuba-college", tenant: "yc.elumenapp.com", catalogYear: "current" },

  // Independent tenants
  { collegeSlug: "antelope-valley-community-college-district", tenant: "avc.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "bakersfield-college", tenant: "bakersfield.elumenapp.com", catalogYear: "2025-2026-Catalog" },
  { collegeSlug: "glendale-community-college", tenant: "glendale.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "lake-tahoe-community-college", tenant: "ltcc.elumenapp.com", catalogYear: "2026-2027" },
  { collegeSlug: "palo-verde-college", tenant: "pvc.elumenapp.com", catalogYear: "2025-2026" },
  { collegeSlug: "college-of-the-redwoods", tenant: "redwoods.elumenapp.com", catalogYear: "2025-2026" },
  { collegeSlug: "college-of-the-siskiyous", tenant: "siskiyous.elumenapp.com", catalogYear: "cos26-27catalog" },
  { collegeSlug: "west-valley-college", tenant: "westvalley.elumenapp.com", catalogYear: "current" },
  { collegeSlug: "college-of-marin", tenant: "marin.elumenapp.com", catalogYear: "current" },
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
