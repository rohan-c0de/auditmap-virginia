/**
 * scrape-smartcatalogiq-programs.ts — GA Smart Catalog IQ program scraper.
 *
 * 13 of Georgia's 22 TCSG colleges publish their catalogs on Smart Catalog IQ.
 * Wiregrass Georgia Technical College uses Acalog (see scrape-programs.ts).
 * Gwinnett Technical College uses Acalog (also in scrape-programs.ts).
 * The remaining 8 use Nimble CMS (4), PDF-only (2), or CleanCatalog (1) —
 * documented as ceilings in lib/states/ga/config.ts.
 *
 * Three colleges embed the catalog year in the catalogPath segment itself
 * (Augusta Tech: "2024-2025-academic-catalog", Columbus Tech:
 * "2024-2025-catalog-and-student-handbook", GA Piedmont: "academic-catalog-2024-2025").
 * For these we intentionally omit catalogPath and let the template's auto-discovery
 * read the homepage links — this way next year's catalog update is picked up
 * automatically without a code change.
 *
 * Three colleges use non-obvious SmartCatalogIQ subdomains:
 *   GA Northwestern Tech  → gntc.smartcatalogiq.com
 *   GA Piedmont Tech      → gptc.smartcatalogiq.com
 *   Oconee Fall Line Tech → oftc.smartcatalogiq.com
 *   Southern Crescent     → sctech.smartcatalogiq.com
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-smartcatalogiq-programs.ts
 *   npx tsx scripts/ga/scrape-smartcatalogiq-programs.ts --college lanier-tech
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { SmartCatalogIqProgramConfig } from "../lib/scrape-smartcatalogiq-programs.js";
import type { CollegePrograms } from "../../lib/types.js";

const COLLEGES: SmartCatalogIqProgramConfig[] = [
  // ── Standard subdomains, explicit catalogPath ──────────────────────────────
  {
    collegeSlug: "athens-tech",
    baseUrl: "https://athenstech.smartcatalogiq.com",
    catalogPath: "catalog",
    // programsPath: "programs-of-study" (default)
  },
  {
    collegeSlug: "atlanta-tech",
    baseUrl: "https://atlantatech.smartcatalogiq.com",
    catalogPath: "college-catalog",
    // programsPath: "programs-of-study" (default)
  },
  {
    // Root URL redirects to chattahoocheetech.edu (auto-discovery fails).
    // Hardcode year + path so the scraper jumps directly to the programs index.
    collegeSlug: "chattahoochee-tech",
    baseUrl: "https://chattahoocheetech.smartcatalogiq.com",
    catalogYear: "2025-2026",
    catalogPath: "general-catalog",
    // programsPath: "programs-of-study" (default)
  },
  {
    // Root URL may redirect away from smartcatalogiq.com (auto-discovery fails).
    // Hardcode year + path so the scraper jumps directly to the programs index.
    collegeSlug: "lanier-tech",
    baseUrl: "https://laniertech.smartcatalogiq.com",
    catalogYear: "2025-2026",
    catalogPath: "catalog",
    // programsPath: "programs-of-study" (default)
  },
  {
    collegeSlug: "ogeechee-tech",
    baseUrl: "https://ogeecheetech.smartcatalogiq.com",
    catalogPath: "catalog",
    // programsPath: "programs-of-study" (default)
  },
  {
    collegeSlug: "savannah-tech",
    baseUrl: "https://savannahtech.smartcatalogiq.com",
    catalogPath: "academic-catalog",
    // programsPath: "programs-of-study" (default)
  },

  // ── Non-obvious subdomains (abbreviations, not name-based) ─────────────────
  {
    // Georgia Northwestern Technical College → "gntc"
    // Programs are in sibling paths: semester-catalog/programs-of-study-business-...
    // and semester-catalog/programs-of-study-health-... (not children of
    // programs-of-study/). followSiblingPaths drops the trailing slash from the
    // link prefix so these sibling paths are discovered correctly.
    collegeSlug: "ga-northwestern-tech",
    baseUrl: "https://gntc.smartcatalogiq.com",
    catalogPath: "semester-catalog",
    followSiblingPaths: true,
    // programsPath: "programs-of-study" (default)
  },

  // ── Year-embedded catalogPaths — omit catalogPath for auto-discovery ────────
  // Augusta Tech: catalogPath is "2024-2025-academic-catalog" — changes yearly.
  // Auto-discovery reads homepage links and resolves it automatically.
  {
    collegeSlug: "augusta-tech",
    baseUrl: "https://augustatech.smartcatalogiq.com",
    // catalogPath: omitted — auto-discovered (year-embedded: "YYYY-YYYY-academic-catalog")
  },
  // Columbus Tech: "2024-2025-catalog-and-student-handbook" — same pattern.
  {
    collegeSlug: "columbus-tech",
    baseUrl: "https://columbustech.smartcatalogiq.com",
    // catalogPath: omitted — auto-discovered (year-embedded)
  },
  // GA Piedmont Tech: "academic-catalog-2024-2025" (year suffix, not prefix) + non-obvious subdomain.
  {
    collegeSlug: "ga-piedmont-tech",
    baseUrl: "https://gptc.smartcatalogiq.com",
    // catalogPath: omitted — auto-discovered (year-embedded: "academic-catalog-YYYY-YYYY")
    programsPath: "programs",
  },

  // ── Non-standard programsPaths ─────────────────────────────────────────────
  // Oconee Fall Line: catalogPath encodes year as "ay26" (academic year 2026).
  // Programs live under "program-areas-of-study" (not "programs-a-z" which is
  // an alphabetical index page with no child links).
  {
    // Oconee Fall Line Technical College → "oftc"
    collegeSlug: "oconee-fall-line-tech",
    baseUrl: "https://oftc.smartcatalogiq.com",
    // catalogPath: omitted — auto-discovered (year-encoded: "ayYY-academic-catalog-handbook")
    programsPath: "program-areas-of-study",
  },
  // West GA Tech: homepage only links to 2021-2022 (stale). 2025-2026 exists at
  // /en/2025-2026/student-catalog/academic-programs/ — hardcode year to bypass.
  {
    collegeSlug: "west-ga-tech",
    baseUrl: "https://westgatech.smartcatalogiq.com",
    catalogYear: "2025-2026",
    catalogPath: "student-catalog",
    programsPath: "academic-programs",
  },
];

// ---------------------------------------------------------------------------
// Multi-division colleges: programs live under separate division paths, not
// under a single programs-of-study/ subtree. Run the template once per
// division and merge results in memory.
// ---------------------------------------------------------------------------

interface MultiDivisionConfig {
  collegeSlug: string;
  baseUrl: string;
  catalogYear: string;
  catalogPath: string;
  divisionPaths: string[];
}

const MULTI_DIVISION_COLLEGES: MultiDivisionConfig[] = [
  {
    // Southern Crescent Technical College → sctech.smartcatalogiq.com
    // Programs sit under top-level division paths, not under programs-of-study/.
    collegeSlug: "southern-crescent-tech",
    baseUrl: "https://sctech.smartcatalogiq.com",
    catalogYear: "2025-2026",
    catalogPath: "catalog",
    divisionPaths: [
      "allied-health-programs",
      "business-programs",
      "computer-information-systems-programs",
      "general-education-programs",
      "professional-services-programs",
      "public-safety-programs",
      "technical-and-industrial-programs",
    ],
  },
  {
    // Columbus Technical College — programs-of-study links to four division pages;
    // individual programs are children of those division paths.
    collegeSlug: "columbus-tech",
    baseUrl: "https://columbustech.smartcatalogiq.com",
    catalogYear: "2024-2025",
    catalogPath: "2024-2025-catalog-and-student-handbook",
    divisionPaths: [
      "division-of-business",
      "division-of-general-studies",
      "division-of-health-sciences-and-nursing",
      "division-of-professional-and-technical-services",
    ],
  },
];

async function scrapeMultiDivision(
  config: MultiDivisionConfig,
): Promise<CollegePrograms> {
  const allPrograms: CollegePrograms["programs"] = [];
  const seen = new Set<string>();

  for (const div of config.divisionPaths) {
    console.log(`  [${config.collegeSlug}] Division: ${div}`);
    try {
      const result = await scrapeSmartCatalogIqPrograms({
        collegeSlug: config.collegeSlug,
        baseUrl: config.baseUrl,
        catalogYear: config.catalogYear,
        catalogPath: config.catalogPath,
        programsPath: div,
      });
      for (const p of result.programs) {
        const key = p.catalog_url ?? p.title;
        if (!seen.has(key)) {
          seen.add(key);
          allPrograms.push(p);
        }
      }
    } catch (e) {
      console.error(`  [${config.collegeSlug}] Division ${div} error: ${e}`);
    }
  }

  return {
    college_slug: config.collegeSlug,
    catalog_year: config.catalogYear,
    catalog_url: `${config.baseUrl}/en/${config.catalogYear}/${config.catalogPath}/`,
    scraped_at: new Date().toISOString(),
    programs: allPrograms,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0
      ? args[args.indexOf("--college") + 1]
      : null);

  let colleges = COLLEGES;
  let multiDivisionColleges = MULTI_DIVISION_COLLEGES;
  if (collegeArg) {
    colleges = COLLEGES.filter((c) => c.collegeSlug === collegeArg);
    multiDivisionColleges = MULTI_DIVISION_COLLEGES.filter((c) => c.collegeSlug === collegeArg);
    if (colleges.length === 0 && multiDivisionColleges.length === 0) {
      const all = [
        ...COLLEGES.map((c) => c.collegeSlug),
        ...MULTI_DIVISION_COLLEGES.map((c) => c.collegeSlug),
      ].join(", ");
      console.error(`Unknown college: ${collegeArg}. Available: ${all}`);
      process.exit(1);
    }
  }

  const outDir = path.join(process.cwd(), "data", "ga", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  const total = colleges.length + multiDivisionColleges.length;
  console.log(`GA SmartCatalogIQ program scraper — ${total} college(s)\n`);

  let totalPrograms = 0;

  // Standard template colleges
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeSmartCatalogIqPrograms(config);

      if (data.programs.length === 0) {
        console.log(`  No programs found for ${config.collegeSlug}, skipping.`);
        continue;
      }

      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );

      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR scraping ${config.collegeSlug}: ${e}`);
    }
  }

  // Multi-division colleges
  for (const config of multiDivisionColleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.baseUrl}) [multi-division]`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeMultiDivision(config);

      if (data.programs.length === 0) {
        console.log(`  No programs found for ${config.collegeSlug}, skipping.`);
        continue;
      }

      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );

      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR scraping ${config.collegeSlug}: ${e}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. Total: ${totalPrograms} programs across ${total} college(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
