/**
 * scrape-programs.ts (NY / CUNY)
 *
 * Closes #230. Scrapes program/degree requirements for the 7 CUNY
 * community colleges via the Coursedog catalog at app.coursedog.com.
 *
 * The college_slug values match data/ny/institutions.json — note that
 * Coursedog subdomains differ from our institution ids (e.g. our slug
 * "bronx-cc" maps to subdomain "bcc.catalog.cuny.edu").
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-programs.ts
 *   npx tsx scripts/ny/scrape-programs.ts --college bmcc
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CoursedogProgramConfig } from "../lib/scrape-coursedog-programs.js";

const COLLEGES: CoursedogProgramConfig[] = [
  { collegeSlug: "bmcc", catalogDomain: "bmcc.catalog.cuny.edu", catalogYear: "2025-2026" },
  { collegeSlug: "bronx-cc", catalogDomain: "bcc.catalog.cuny.edu", catalogYear: "2025-2026" },
  { collegeSlug: "guttman-cc", catalogDomain: "guttman.catalog.cuny.edu", catalogYear: "2025-2026" },
  { collegeSlug: "hostos-cc", catalogDomain: "hostos.catalog.cuny.edu", catalogYear: "2025-2026" },
  { collegeSlug: "kingsborough-cc", catalogDomain: "kbcc.catalog.cuny.edu", catalogYear: "2025-2026" },
  { collegeSlug: "laguardia-cc", catalogDomain: "laguardia.catalog.cuny.edu", catalogYear: "2025-2026" },
  { collegeSlug: "queensborough-cc", catalogDomain: "qcc.catalog.cuny.edu", catalogYear: "2025-2026" },
];

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0 ? args[args.indexOf("--college") + 1] : null);

  let colleges = COLLEGES;
  if (collegeArg) {
    colleges = COLLEGES.filter((c) => c.collegeSlug === collegeArg);
    if (colleges.length === 0) {
      console.error(
        `Unknown college: ${collegeArg}. Available: ${COLLEGES.map((c) => c.collegeSlug).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const outDir = path.join(process.cwd(), "data", "ny", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`NY/CUNY program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping ${config.collegeSlug} (${config.catalogDomain})`);
    console.log("=".repeat(60));

    try {
      const data = await scrapeCoursedogPrograms(config);
      if (data.programs.length === 0) {
        console.log(`  No programs scraped for ${config.collegeSlug}, skipping write.`);
        continue;
      }

      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );

      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs to ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(
        `  ERROR scraping ${config.collegeSlug}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Done. Total: ${totalPrograms} programs across ${colleges.length} college(s).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
