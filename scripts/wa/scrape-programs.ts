/**
 * scrape-programs.ts — degree/program requirements for WA (SBCTC).
 *
 * Sources:
 *   Acalog (15 colleges) — same verified catalogs as scrape-catalog-prereqs.ts.
 *     These hosts sit behind AWS WAF JS-challenge (HTTP 202 + empty body on
 *     flagged plain fetch), so usePlaywright routes every request through
 *     headless Chromium. Program discovery via search_advanced.php
 *     (useSearchDiscovery) — listing pages are JS-rendered.
 *   Coursedog (1) — Tacoma CC at catalog.tacomacc.edu.
 *   CourseLeaf (2) — Clark (/degree-certificate-requirements/), SPSCC.
 *   CleanCatalog (3) — Bates Tech, Cascadia, Wenatchee Valley.
 *
 * Spokane CC + Spokane Falls CC use the custom catalog.spokane.edu site and
 * are handled by scrape-ccs-programs.ts, not here. Seattle Colleges publish
 * no scrapeable catalog (catalog.seattlecolleges.edu is a redirect loop;
 * catalog.nscc.edu is Nashville State TN and catalog.wallawalla.edu is Walla
 * Walla University — do not "rediscover" either).
 *
 * Output filenames use data/wa/institutions.json college_slug values — note
 * Pierce is `pierce-college-district` there, not `pierce-college`.
 *
 * Usage:
 *   npx tsx scripts/wa/scrape-programs.ts
 *   npx tsx scripts/wa/scrape-programs.ts --college=bellevue
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";

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
    // Some WA catalogs (Edmonds) publish scaffolding as program-type items —
    // distribution course lists, degree templates, pathway examples. Drop
    // them; they aren't degrees a student can plan toward.
    const before = data.programs.length;
    data.programs = (data.programs as { title?: string }[]).filter(
      (p) =>
        !/^(Course List|Template\b|Program Map|Guided pathway|Degree Map)/i.test(
          String(p.title ?? ""),
        ),
    );
    if (data.programs.length < before) {
      console.log(`  Filtered ${before - data.programs.length} scaffolding items`);
    }
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug}.`);
      return;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs as never);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", "wa", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

// collegeSlug = institutions.json college_slug (the planner's join key).
const ACALOG: { collegeSlug: string; baseUrl: string; catoid: number }[] = [
  { collegeSlug: "bellevue-college", baseUrl: "https://catalog.bellevuecollege.edu", catoid: 16 },
  { collegeSlug: "bellingham-technical-college", baseUrl: "https://catalog.btc.edu", catoid: 15 },
  { collegeSlug: "centralia-college", baseUrl: "https://catalog.centralia.edu", catoid: 6 },
  { collegeSlug: "edmonds-college", baseUrl: "https://catalog.edmonds.edu", catoid: 68 },
  { collegeSlug: "grays-harbor-college", baseUrl: "https://catalog.ghc.edu", catoid: 17 },
  { collegeSlug: "green-river-college", baseUrl: "https://catalog.greenriver.edu", catoid: 10 },
  { collegeSlug: "highline-college", baseUrl: "https://catalog.highline.edu", catoid: 31 },
  { collegeSlug: "lake-washington-institute-of-technology", baseUrl: "https://catalog.lwtech.edu", catoid: 20 },
  { collegeSlug: "olympic-college", baseUrl: "https://catalog.olympic.edu", catoid: 24 },
  // catoid 21 = current catalog (homepage dropdown only lists archived ones).
  { collegeSlug: "pierce-college-district", baseUrl: "https://catalog.pierce.ctc.edu", catoid: 21 },
  { collegeSlug: "renton-technical-college", baseUrl: "https://catalog.rtc.edu", catoid: 23 },
  { collegeSlug: "shoreline-community-college", baseUrl: "https://catalog.shoreline.edu", catoid: 8 },
  { collegeSlug: "skagit-valley-college", baseUrl: "https://catalog.skagit.edu", catoid: 35 },
  { collegeSlug: "walla-walla-community-college", baseUrl: "https://catalog.wwcc.edu", catoid: 6 },
  { collegeSlug: "yakima-valley-college", baseUrl: "https://catalog.yvcc.edu", catoid: 12 },
];

const COURSELEAF: {
  collegeSlug: string;
  baseUrl: string;
  programIndexPath?: string;
  indexDepth?: 1 | 2;
  programPathPattern?: string;
}[] = [
  // Clark's index links 40 area pages; programs are one level deeper.
  { collegeSlug: "clark-college", baseUrl: "https://catalog.clark.edu", programIndexPath: "/academic-plans/", indexDepth: 2 },
  // SPSCC has no single program index; the site nav links every program as
  // /<division>/(ado|cert)/<name>/. Host is AWS-WAF-fronted (lib recovers).
  {
    collegeSlug: "south-puget-sound-community-college",
    baseUrl: "https://catalog.spscc.edu",
    programIndexPath: "/",
    programPathPattern: "^/[a-z0-9-]+/(ado|cert)/[a-z0-9-]+/$",
  },
];

const CLEANCATALOG: { collegeSlug: string; baseUrl: string; indexPaths?: string[]; catalogYear: string }[] = [
  { collegeSlug: "bates-technical-college", baseUrl: "https://catalog.batestech.edu", indexPaths: ["/degrees", "/degrees-and-certificates"], catalogYear: "2025-2026" },
  { collegeSlug: "cascadia-college", baseUrl: "https://catalog.cascadia.edu", indexPaths: ["/degrees", "/certificate-programs"], catalogYear: "2025-2026" },
  { collegeSlug: "wenatchee-valley-college", baseUrl: "https://catalog.wvc.edu", indexPaths: ["/degrees", "/programs"], catalogYear: "2025-2026" },
];

async function main() {
  const collegeFilter = process.argv
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("WA program scraper");

  const acalog = collegeFilter
    ? ACALOG.filter((c) => c.collegeSlug.includes(collegeFilter))
    : ACALOG;

  for (const c of acalog) {
    await run(c.collegeSlug, () =>
      scrapeAcalogPrograms({
        collegeSlug: c.collegeSlug,
        baseUrl: c.baseUrl,
        catoidFallback: c.catoid,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (!collegeFilter || "tacoma-community-college".includes(collegeFilter)) {
    await run("tacoma-community-college", () =>
      scrapeCoursedogPrograms({
        collegeSlug: "tacoma-community-college",
        catalogDomain: "catalog.tacomacc.edu",
        catalogYear: "",
      }),
    );
  }

  for (const c of COURSELEAF.filter(
    (c) => !collegeFilter || c.collegeSlug.includes(collegeFilter),
  )) {
    await run(c.collegeSlug, () => scrapeCourseleafPrograms(c));
  }

  for (const c of CLEANCATALOG.filter(
    (c) => !collegeFilter || c.collegeSlug.includes(collegeFilter),
  )) {
    await run(c.collegeSlug, () => scrapeCleanCatalogPrograms(c));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
