/**
 * scrape-programs.ts — degree/program requirements for IN.
 *
 * Coverage:
 * - Ivy Tech Community College — Acalog (catalog.ivytech.edu, catoid=13,
 *   single statewide system). Scraped via the shared Acalog template.
 *   Program nav pages are auto-discovered; search_advanced.php is the
 *   fallback if navoid discovery comes up empty.
 *
 * Indiana is a single-institution state for our purposes (Ivy Tech), so this
 * one catalog covers the whole state. The output filename MUST equal the
 * institution college_slug ("ivy-tech-community-college") or the planner
 * silently ignores it (slug-align gotcha).
 *
 * Usage:
 *   npx tsx scripts/in/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import {
  scrapeAcalogPrograms,
  discoverProgramNavoids,
} from "../lib/scrape-acalog-programs.js";
import { discoverAcalogCatoid } from "../lib/discover-catalog.js";

const SLUG = "ivy-tech-community-college";
const BASE_URL = "https://catalog.ivytech.edu";
const CATOID_FALLBACK = 13;

async function main() {
  console.log("IN program scraper — Ivy Tech");

  const catoid = await discoverAcalogCatoid(BASE_URL, CATOID_FALLBACK);
  console.log(`  catoid=${catoid}`);

  const navoids = await discoverProgramNavoids(BASE_URL, catoid);
  console.log(`  discovered navoids: ${navoids.join(", ") || "(none)"}`);

  const data = await scrapeAcalogPrograms({
    collegeSlug: SLUG,
    baseUrl: BASE_URL,
    catoidFallback: catoid,
    autoDiscoverCatoid: false, // already discovered above
    programNavoids: navoids,
    useSearchDiscovery: true, // fallback if navoid scan finds nothing
  });

  if (data.programs.length === 0) {
    console.error("  ✗ No programs found — leaving existing data untouched.");
    process.exit(1);
  }

  const { matched, unmatched } = applyProgramMatching(data.programs as never);
  console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);

  const outDir = path.join(process.cwd(), "data", "in", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${SLUG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
