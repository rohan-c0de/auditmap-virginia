/**
 * scrape-programs.ts — degree/program requirements for Idaho.
 *
 * ID has 4 community colleges, each on a different catalog platform — all with
 * shared lib scrapers:
 *   - college-of-eastern-idaho  → Acalog        (catalog.cei.edu)
 *   - college-of-western-idaho  → CourseLeaf     (cwi.edu/catalog)
 *   - north-idaho-college       → Coursedog      (catalog.nic.edu)
 *   - college-of-southern-idaho → SmartCatalogIQ (csi.smartcatalogiq.com)
 *
 * Output filename MUST equal the institution college_slug (slug-align gotcha).
 *
 * Usage:
 *   npx tsx scripts/id/scrape-programs.ts                 # all colleges
 *   npx tsx scripts/id/scrape-programs.ts --college north-idaho-college
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";

type Result = { programs: unknown[] };

async function writeOut(slug: string, data: Result): Promise<number> {
  if (!data.programs || data.programs.length === 0) {
    console.log(`  ${slug}: 0 programs — not writing (left untouched)`);
    return 0;
  }
  const { matched, unmatched } = applyProgramMatching(data.programs as never);
  console.log(`  ${slug}: matcher ${matched} matched / ${unmatched} unmatched`);
  const outDir = path.join(process.cwd(), "data", "id", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${slug}.json`),
    JSON.stringify(data, null, 2),
  );
  console.log(`  ✓ ${slug}: ${data.programs.length} programs`);
  return data.programs.length;
}

const RUNNERS: Record<string, () => Promise<Result>> = {
  // catalog.cei.edu has an incomplete TLS chain (UNABLE_TO_VERIFY_LEAF_SIGNATURE
  // on Node fetch); Chromium tolerates it, so route through Playwright. Programs
  // aren't on a nav page — discovered via search_advanced.php. catoid=9 current.
  "college-of-eastern-idaho": () =>
    scrapeAcalogPrograms({
      collegeSlug: "college-of-eastern-idaho",
      baseUrl: "https://catalog.cei.edu",
      catoidFallback: 9,
      autoDiscoverCatoid: false,
      programNavoids: [],
      useSearchDiscovery: true,
      usePlaywright: true,
    }),
  // CourseLeaf lives on catalog.cwi.edu (cwi.edu/catalog is a front door).
  "college-of-western-idaho": () =>
    scrapeCourseleafPrograms({
      collegeSlug: "college-of-western-idaho",
      baseUrl: "https://catalog.cwi.edu",
    }),
  // DEFERRED-scrapers: north-idaho-college — Coursedog (catalog.nic.edu,
  // tenant nic_colleague_ethos) lists 165 programs but the shared Coursedog
  // parser extracts 0 requirement groups from them (known Coursedog ceiling —
  // see memory reference_programs_scraping_playbook). Fixing the shared
  // scrape-coursedog-programs.ts parser is out of scope for this PR. Re-enable
  // here once that parser handles NIC's requirement format.
  // "north-idaho-college": () =>
  //   scrapeCoursedogPrograms({
  //     collegeSlug: "north-idaho-college",
  //     catalogDomain: "catalog.nic.edu",
  //     catalogYear: "2026-2027",
  //   }),
  // CSI's catalog path is "2026-2027-catalog"; programs-of-study holds the
  // ~155 program pages (default programsPath, but the non-default catalogPath
  // is what the default config got wrong).
  "college-of-southern-idaho": () =>
    scrapeSmartCatalogIqPrograms({
      collegeSlug: "college-of-southern-idaho",
      baseUrl: "https://csi.smartcatalogiq.com",
      catalogYear: "2026-2027",
      catalogPath: "2026-2027-catalog",
      programsPath: "programs-of-study",
      followSiblingPaths: true,
    }),
};

async function main() {
  const i = process.argv.indexOf("--college");
  const only = i >= 0 ? process.argv[i + 1] : null;
  console.log("ID program scraper");
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
  console.log(`\nTotal: ${total} programs across ID`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
