/**
 * scrape-misc-programs.ts — NC program scraper for the minor catalog platforms
 * (CourseDog, CourseLeaf, CleanCatalog) identified in catalog-discovery.json.
 * Each dispatches to the matching shared lib scraper.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-misc-programs.ts
 *   npx tsx scripts/nc/scrape-misc-programs.ts --college cape-fear
 */
import * as fs from "fs";
import * as path from "path";
import { scrapeCoursedogPrograms } from "../lib/scrape-coursedog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";

interface Discovery { slug: string; domain: string; platform: string; catalogUrl: string | null; }

const CATALOG_YEAR = "2025-2026";
const base = (u: string) => (u.match(/^https?:\/\/[^/]+/)?.[0] ?? u).replace(/\/$/, "");
const domainOf = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

async function scrapeOne(c: Discovery) {
  switch (c.platform) {
    case "coursedog":
      return scrapeCoursedogPrograms({ collegeSlug: c.slug, catalogDomain: domainOf(c.catalogUrl!), catalogYear: CATALOG_YEAR });
    case "courseleaf": {
      // CourseLeaf installs name the program index inconsistently; try the
      // common conventions until one yields programs.
      const candidates = ["/programs-a-z/", "/programs/", "/programs-study/", "/program/"];
      for (const programIndexPath of candidates) {
        const data = await scrapeCourseleafPrograms({ collegeSlug: c.slug, baseUrl: base(c.catalogUrl!), programIndexPath });
        if (data.programs.length > 0) return data;
      }
      return scrapeCourseleafPrograms({ collegeSlug: c.slug, baseUrl: base(c.catalogUrl!) });
    }
    case "cleancatalog":
      return scrapeCleanCatalogPrograms({ collegeSlug: c.slug, baseUrl: base(c.catalogUrl!), catalogYear: CATALOG_YEAR });
    default:
      return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0 ? args[args.indexOf("--college") + 1] : null);

  const disc: Discovery[] = JSON.parse(fs.readFileSync("data/fl/catalog-discovery.json", "utf8"));
  let colleges = disc.filter((d) => ["coursedog", "courseleaf", "cleancatalog"].includes(d.platform) && d.catalogUrl);
  if (collegeArg) colleges = colleges.filter((c) => c.slug === collegeArg);

  const outDir = path.join(process.cwd(), "data", "fl", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`FL misc-platform program scraper — ${colleges.length} college(s)\n`);
  let total = 0;
  const summary: { slug: string; platform: string; programs: number; matched: number }[] = [];

  for (const c of colleges) {
    console.log(`\n${"=".repeat(60)}\n${c.slug} [${c.platform}] ${c.catalogUrl}\n${"=".repeat(60)}`);
    try {
      const data = await scrapeOne(c);
      if (!data || data.programs.length === 0) {
        console.log(`  No programs found for ${c.slug}, skipping.`);
        summary.push({ slug: c.slug, platform: c.platform, programs: 0, matched: 0 });
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      fs.writeFileSync(path.join(outDir, `${c.slug}.json`), JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs`);
      total += data.programs.length;
      summary.push({ slug: c.slug, platform: c.platform, programs: data.programs.length, matched });
    } catch (e) {
      console.error(`  ERROR scraping ${c.slug}: ${e}`);
      summary.push({ slug: c.slug, platform: c.platform, programs: -1, matched: 0 });
    }
  }
  console.log(`\nDone. ${total} programs across ${colleges.length} college(s).`);
  console.table(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
