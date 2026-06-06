/**
 * scrape-programs.ts — degree/program requirements for NM.
 *
 * NOTE: the original auto-generated version (from scripts/lib/discover-
 * programs.ts) guessed base URLs from college names and landed on unrelated
 * out-of-state institutions — e.g. catalog.northern.edu is Northern State
 * University (South Dakota), not Northern New Mexico College. Those were
 * corrected against the colleges' real catalogs, and the three largest NM
 * colleges (Central NM, San Juan, Santa Fe) were added.
 *
 * Coverage: 5 of NM's 12 colleges have a discoverable templated catalog.
 * Eastern NM University–Ruidoso (PDF-only catalog), Clovis, and NMJC have no
 * Acalog/Coursedog catalog and are deferred.
 *
 * Usage:
 *   npx tsx scripts/nm/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";

async function run(
  slug: string,
  scrape: () => Promise<{ programs: unknown[]; catalog_year: string; catalog_url: string; college_slug: string; scraped_at: string }>,
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
    const outDir = path.join(process.cwd(), "data", "nm", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

// Acalog catalogs — program-listing pages are JS-rendered, so discover via
// search_advanced.php (useSearchDiscovery) rather than per-college navoids.
const ACALOG: { collegeSlug: string; baseUrl: string }[] = [
  { collegeSlug: "central-new-mexico-community-college", baseUrl: "https://catalog.cnm.edu" },
  { collegeSlug: "san-juan-college", baseUrl: "https://catalog.sanjuancollege.edu" },
  { collegeSlug: "santa-fe-community-college", baseUrl: "https://catalog.sfcc.edu" },
  { collegeSlug: "northern-new-mexico-college", baseUrl: "https://catalog.nnmc.edu" },
];

async function main() {
  console.log("NM program scraper");

  for (const c of ACALOG) {
    await run(c.collegeSlug, () =>
      scrapeAcalogPrograms({
        collegeSlug: c.collegeSlug,
        baseUrl: c.baseUrl,
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
      }),
    );
  }

  // Southeast NM College — Coursedog (auto-discovers tenantId + catalogId).
  await run("southeast-new-mexico-college", () =>
    scrapeCoursedogPrograms({
      collegeSlug: "southeast-new-mexico-college",
      catalogDomain: "catalog.senmc.edu",
      catalogYear: "",
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
