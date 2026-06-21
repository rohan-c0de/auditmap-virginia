/**
 * scrape-programs.ts — degree/program requirements for KS.
 *
 * 10 of 24 KS colleges publish their program catalog via one of four
 * scrapeable platforms; all URLs probed live 2026-06-21 (catalog title
 * matched college name, no out-of-state trap). The remaining 14 are
 * documented as ceilings in lib/states/ks/config.ts:documentedCeilings.
 *
 * Platform breakdown:
 *   Acalog       — butler, coffeyville, colby, cowley, garden-city, kckcc, neosho
 *   CourseLeaf   — johnson-county-community-college
 *   Coursedog    — allen-county-community-college
 *   CleanCatalog — seward-county-community-college
 *
 * Run once-only (catalog year changes annually):
 *   npx tsx scripts/ks/scrape-programs.ts
 *   npx tsx scripts/ks/scrape-programs.ts --college=<slug>
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";

const CATALOG_YEAR = "2026-2027";

interface ProgramScrapeResult {
  programs: unknown[];
  catalog_year: string;
  catalog_url: string;
  college_slug: string;
  scraped_at: string;
}

async function run(
  slug: string,
  scrape: () => Promise<ProgramScrapeResult>,
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
    const outDir = path.join(process.cwd(), "data", "ks", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const filter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  const isWanted = (slug: string) => !filter || filter === slug;

  console.log("🌾 Kansas program scraper");

  // -------- Acalog (7 colleges) --------
  if (isWanted("butler-community-college")) {
    await run("butler-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "butler-community-college",
        baseUrl: "https://catalog.butlercc.edu",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (isWanted("coffeyville-community-college")) {
    await run("coffeyville-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "coffeyville-community-college",
        baseUrl: "https://coffeyville.catalog.acalog.com",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (isWanted("colby-community-college")) {
    await run("colby-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "colby-community-college",
        baseUrl: "https://catalog.colbycc.edu",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (isWanted("cowley-county-community-college")) {
    await run("cowley-county-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "cowley-county-community-college",
        baseUrl: "https://catalog.cowley.edu",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (isWanted("garden-city-community-college")) {
    await run("garden-city-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "garden-city-community-college",
        baseUrl: "https://catalog.gcccks.edu",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (isWanted("kansas-city-kansas-community-college")) {
    await run("kansas-city-kansas-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "kansas-city-kansas-community-college",
        baseUrl: "https://catalog.kckcc.edu",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  if (isWanted("neosho-county-community-college")) {
    await run("neosho-county-community-college", () =>
      scrapeAcalogPrograms({
        collegeSlug: "neosho-county-community-college",
        baseUrl: "https://catalog.neosho.edu",
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
        usePlaywright: true,
      }),
    );
  }

  // -------- CourseLeaf (1 college) --------
  if (isWanted("johnson-county-community-college")) {
    await run("johnson-county-community-college", () =>
      scrapeCourseleafPrograms({
        collegeSlug: "johnson-county-community-college",
        baseUrl: "https://catalog.jccc.edu",
        // JCCC's index lives at /degreecertificates/<area>/<program-slug>/ —
        // two-level walk (area → program).
        programIndexPath: "/degreecertificates/",
        indexDepth: 2,
      }),
    );
  }

  // -------- Coursedog (1 college, deferred) --------
  // allen-county-community-college: catalog.allencc.edu serves 111 programs
  // via the standard Coursedog API, but the tenant (allencc_jenzabar) returns
  // empty `requisites.requisitesSimple` AND empty `requisitesFreeform` on
  // every program (verified 2026-06-21). Requirements live in some other
  // tenant-specific field the shared lib doesn't read yet. Deferred to a
  // follow-up that extends scripts/lib/scrape-coursedog-programs.ts to handle
  // jenzabar-flavored Coursedog tenants.

  // -------- CleanCatalog (1 college) --------
  if (isWanted("seward-county-community-college")) {
    await run("seward-county-community-college", () =>
      scrapeCleanCatalogPrograms({
        collegeSlug: "seward-county-community-college",
        baseUrl: "https://catalog.sccc.edu",
        catalogYear: CATALOG_YEAR,
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
