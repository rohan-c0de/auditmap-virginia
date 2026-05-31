/**
 * CA — programs scraper for colleges on existing platform templates
 *
 * Covers California CCs whose catalogs run on Acalog, CourseLeaf,
 * Coursedog, or SmartCatalogIQ — all platforms with pre-built shared
 * templates in scripts/lib/. eLumen (30 CCs) and Curricunet (20 CCs)
 * require new templates and are deferred to follow-up PRs.
 *
 * Coverage as of 2026-05-30 (31 colleges, see data/ca/_ca-catalog-fingerprint.md):
 *
 *   CourseLeaf (24):
 *     foothill-college, miracosta-college, citrus-college, college-of-the-desert,
 *     long-beach-city-college, mt-san-antonio-college, mt-san-jacinto-cc-district,
 *     napa-valley-college, pasadena-city-college, santa-barbara-city-college,
 *     san-jose-city-college, college-of-the-sequoias, sierra-college,
 *     san-bernardino-valley-college, southwestern-college, victor-valley-college,
 *     evergreen-valley-college,
 *     and 7 district-shared:
 *       NOCCCD: cypress-college, fullerton-college
 *       CCCD:   coastline-cc, golden-west-college, orange-coast-college
 *       VCCCD:  moorpark-college, oxnard-college, ventura-college
 *       GCCCD:  cuyamaca-college, grossmont-college
 *
 *   Acalog (2):
 *     san-joaquin-delta-college, monterey-peninsula-college
 *
 *   SmartCatalogIQ (2):
 *     crafton-hills-college, taft-college
 *
 *   Coursedog (3):
 *     hartnell-college, merced-college
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-template-programs.ts
 *   npx tsx scripts/ca/scrape-template-programs.ts --college=foothill-college
 *   npx tsx scripts/ca/scrape-template-programs.ts --platform=courseleaf
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CourseleafProgramConfig } from "../lib/scrape-courseleaf-programs.js";
import type { AcalogProgramConfig } from "../lib/scrape-acalog-programs.js";
import type { SmartCatalogIqProgramConfig } from "../lib/scrape-smartcatalogiq-programs.js";
import type { CoursedogProgramConfig } from "../lib/scrape-coursedog-programs.js";

const COURSELEAF: CourseleafProgramConfig[] = [
  // Single-college instances — most CA CourseLeaf catalogs publish programs at
  // /degrees-certificates/, not the template default /programs-study/
  { collegeSlug: "foothill-college", baseUrl: "https://catalog.foothill.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "miracosta-college", baseUrl: "https://catalog.miracosta.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "citrus-college", baseUrl: "https://catalog.citruscollege.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "college-of-the-desert", baseUrl: "https://catalog.collegeofthedesert.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "long-beach-city-college", baseUrl: "https://lbcc-public.courseleaf.com", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "mt-san-antonio-college", baseUrl: "https://catalog.mtsac.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "mt-san-jacinto-community-college-district", baseUrl: "https://catalog.msjc.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "napa-valley-college", baseUrl: "https://catalog.napavalley.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "pasadena-city-college", baseUrl: "https://curriculum.pasadena.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "santa-barbara-city-college", baseUrl: "https://catalog.sbcc.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "san-jose-city-college", baseUrl: "https://catalog.sjcc.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "college-of-the-sequoias", baseUrl: "https://catalog.cos.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "sierra-college", baseUrl: "https://catalog.sierracollege.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "san-bernardino-valley-college", baseUrl: "https://catalog.valleycollege.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "southwestern-college", baseUrl: "https://catalog.swccd.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "victor-valley-college", baseUrl: "https://catalog.vvc.edu", programIndexPath: "/degrees-certificates/" },
  { collegeSlug: "evergreen-valley-college", baseUrl: "https://catalog.evc.edu", programIndexPath: "/degrees-certificates/" },
  // District-shared catalogs — programs live under /{college}/
  { collegeSlug: "cypress-college", baseUrl: "https://catalog.nocccd.edu", programIndexPath: "/cypress-college/" },
  { collegeSlug: "fullerton-college", baseUrl: "https://catalog.nocccd.edu", programIndexPath: "/fullerton-college/" },
  { collegeSlug: "coastline-community-college", baseUrl: "https://catalog.cccd.edu", programIndexPath: "/coastline/" },
  { collegeSlug: "golden-west-college", baseUrl: "https://catalog.cccd.edu", programIndexPath: "/golden-west/" },
  { collegeSlug: "orange-coast-college", baseUrl: "https://catalog.cccd.edu", programIndexPath: "/orange-coast/" },
  { collegeSlug: "moorpark-college", baseUrl: "https://catalog.vcccd.edu", programIndexPath: "/moorpark/" },
  { collegeSlug: "oxnard-college", baseUrl: "https://catalog.vcccd.edu", programIndexPath: "/oxnard/" },
  { collegeSlug: "ventura-college", baseUrl: "https://catalog.vcccd.edu", programIndexPath: "/ventura/" },
  { collegeSlug: "cuyamaca-college", baseUrl: "https://catalog.gcccd.edu", programIndexPath: "/cuyamaca/" },
  { collegeSlug: "grossmont-college", baseUrl: "https://catalog.gcccd.edu", programIndexPath: "/grossmont/" },
];

const ACALOG: AcalogProgramConfig[] = [
  {
    collegeSlug: "san-joaquin-delta-college",
    baseUrl: "https://catalog.deltacollege.edu",
    catoidFallback: 1,
    programNavoids: [1],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
  },
  {
    collegeSlug: "monterey-peninsula-college",
    baseUrl: "https://catalog.mpc.edu",
    catoidFallback: 1,
    programNavoids: [1],
    autoDiscoverCatoid: true,
    useSearchDiscovery: true,
    usePlaywright: true, // AWS WAF
  },
];

const SCIQ: SmartCatalogIqProgramConfig[] = [
  {
    collegeSlug: "crafton-hills-college",
    baseUrl: "https://craftonhills.smartcatalogiq.com",
    catalogYear: "2025-2026",
  },
  {
    collegeSlug: "taft-college",
    baseUrl: "https://taftcollege.smartcatalogiq.com",
    catalogYear: "2026-2027",
  },
];

const COURSEDOG: CoursedogProgramConfig[] = [
  // CA Coursedog catalogs typically auto-discover catalog_id by school slug
  { collegeSlug: "hartnell-college", catalogDomain: "hartnell.catalog.prod.coursedog.com", catalogYear: "2025-2026" },
  { collegeSlug: "merced-college", catalogDomain: "catalog.mccd.edu", catalogYear: "2025-2026" },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg = args.find((a) => a.startsWith("--college="))?.split("=")[1];
  const platformArg = args.find((a) => a.startsWith("--platform="))?.split("=")[1];

  const outDir = path.join(process.cwd(), "data", "ca", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  let totalPrograms = 0;
  let attempted = 0;
  let succeeded = 0;

  async function processBatch<T extends { collegeSlug: string }>(
    label: string,
    configs: T[],
    scrapeFn: (cfg: T) => Promise<{ programs: unknown[] } | null>,
  ) {
    if (platformArg && label.toLowerCase() !== platformArg.toLowerCase()) return;

    for (const cfg of configs) {
      if (collegeArg && cfg.collegeSlug !== collegeArg) continue;
      attempted++;
      console.log(`\n${"=".repeat(60)}`);
      console.log(`${label}: ${cfg.collegeSlug}`);
      console.log("=".repeat(60));
      try {
        const data = await scrapeFn(cfg);
        if (!data || data.programs.length === 0) {
          console.log(`  No programs scraped for ${cfg.collegeSlug}.`);
          continue;
        }
        const { matched, unmatched } = applyProgramMatching(data.programs as Parameters<typeof applyProgramMatching>[0]);
        console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
        const outPath = path.join(outDir, `${cfg.collegeSlug}.json`);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
        console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
        totalPrograms += data.programs.length;
        succeeded++;
      } catch (e) {
        console.error(`  ERROR ${cfg.collegeSlug}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await processBatch("CourseLeaf", COURSELEAF, (cfg) => scrapeCourseleafPrograms(cfg));
  await processBatch("Acalog", ACALOG, (cfg) => scrapeAcalogPrograms(cfg));
  await processBatch("SCIQ", SCIQ, (cfg) => scrapeSmartCatalogIqPrograms(cfg));
  await processBatch("Coursedog", COURSEDOG, (cfg) =>
    scrapeCoursedogPrograms({
      collegeSlug: cfg.collegeSlug,
      catalogDomain: cfg.catalogDomain,
      catalogYear: cfg.catalogYear,
    }),
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. ${totalPrograms} programs from ${succeeded}/${attempted} colleges.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
