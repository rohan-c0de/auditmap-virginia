/**
 * scrape-programs.ts — degree/program requirements for AR.
 *
 * AR has no single CC system; catalog platforms are mixed across the 14
 * colleges. The auto-add-state discover-programs.ts seeded this file with
 * 2 cross-state false positives:
 *
 *   - "southeast-arkansas-college" → catalog.southeast.edu (Southeast
 *     College of Building Trades) — different college, removed.
 *   - "south-arkansas-college"     → catalog.south.edu (South College, TN)
 *     — different college, removed.
 *
 * Verified (2026-05-25) hand-curated entries:
 *
 *   national-park-college  → catalog.np.edu      (Acalog, catoid 27, navoid 9848)
 *   north-arkansas-college → catalog.northark.edu (Acalog, catoid 17, navoid 1408)
 *
 * Deferred to follow-ups (with reason):
 *
 *   NWACC  — catalog.nwacc.edu Acalog returns HTTP 403 to any scripted
 *            UA. Browser-rendered or requires login workaround.
 *   PCCUA  — hosted on www.pccua.edu under a bespoke Bootstrap layout,
 *            not Clean Catalog. Needs a custom parser (~2 hr).
 *   Cossatot, Ozarka, UACCM, UACC Rich Mountain — per-college bespoke
 *            HTML; ~1 hr each.
 *   ANC, BRTC, EACC, South Arkansas, SEARK, UACCB — PDF-only catalogs;
 *            6 PDFs of varying layouts.
 *
 * Coverage after this pass: 2 of 14 colleges (14%).
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";

const STATE = "ar";

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
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug}.`);
      return;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs as never);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", STATE, "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("AR program scraper");

  // National Park College — Acalog at catalog.np.edu (catoid 27, navoid 9848)
  await run("national-park-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "national-park-college",
      baseUrl: "https://catalog.np.edu",
      catoidFallback: 27,
      programNavoids: [9848],
      autoDiscoverCatoid: true,
    }),
  );

  // North Arkansas College — Acalog at catalog.northark.edu (catoid 17, navoid 1408)
  await run("north-arkansas-college", () =>
    scrapeAcalogPrograms({
      collegeSlug: "north-arkansas-college",
      baseUrl: "https://catalog.northark.edu",
      catoidFallback: 17,
      programNavoids: [1408],
      autoDiscoverCatoid: true,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
