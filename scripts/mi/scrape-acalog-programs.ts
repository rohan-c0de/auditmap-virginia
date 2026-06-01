/**
 * scrape-acalog-programs.ts — NC Acalog program scraper.
 *
 * Reads data/mi/catalog-discovery.json, filters colleges fingerprinted as
 * `acalog`, and scrapes each generically: auto-discover the active catoid,
 * auto-discover program navoids from the sidebar, and fall back to
 * search_advanced.php when no navoid yields programs. No per-college pinning —
 * everything is discovered from the live catalog.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-acalog-programs.ts
 *   npx tsx scripts/nc/scrape-acalog-programs.ts --college gaston
 */
import * as fs from "fs";
import * as path from "path";
import {
  scrapeAcalogPrograms,
  discoverProgramNavoids,
} from "../lib/scrape-acalog-programs.js";
import { discoverAcalogCatoid } from "../lib/discover-catalog.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";

interface Discovery {
  slug: string;
  domain: string;
  platform: string;
  catalogUrl: string | null;
}

function baseFromUrl(u: string): string {
  const m = u.match(/^https?:\/\/[^/]+/);
  return m ? m[0] : u.replace(/\/$/, "");
}

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0 ? args[args.indexOf("--college") + 1] : null);

  const disc: Discovery[] = JSON.parse(
    fs.readFileSync("data/mi/catalog-discovery.json", "utf8")
  );
  let colleges = disc.filter((d) => d.platform === "acalog" && d.catalogUrl);
  if (collegeArg) colleges = colleges.filter((c) => c.slug === collegeArg);

  const outDir = path.join(process.cwd(), "data", "mi", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`NC Acalog program scraper — ${colleges.length} college(s)\n`);
  let totalPrograms = 0;
  const summary: { slug: string; catoid: number; navoids: number; programs: number; matched: number }[] = [];

  for (const c of colleges) {
    const base = baseFromUrl(c.catalogUrl!);
    console.log(`\n${"=".repeat(60)}\nScraping ${c.slug} (${base})\n${"=".repeat(60)}`);
    try {
      const catoid = await discoverAcalogCatoid(base, 1);
      let navoids: number[] = [];
      try {
        navoids = await discoverProgramNavoids(base, catoid);
      } catch (e) {
        console.warn(`  navoid discovery failed: ${e}`);
      }
      console.log(`  catoid=${catoid} navoids=[${navoids.join(",")}]`);
      const data = await scrapeAcalogPrograms({
        collegeSlug: c.slug,
        baseUrl: base,
        catoidFallback: catoid,
        autoDiscoverCatoid: false,
        programNavoids: navoids,
        useSearchDiscovery: true,
      });
      if (data.programs.length === 0) {
        console.log(`  No programs found for ${c.slug}, skipping.`);
        summary.push({ slug: c.slug, catoid, navoids: navoids.length, programs: 0, matched: 0 });
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      const outPath = path.join(outDir, `${c.slug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
      totalPrograms += data.programs.length;
      summary.push({ slug: c.slug, catoid, navoids: navoids.length, programs: data.programs.length, matched });
    } catch (e) {
      console.error(`  ERROR scraping ${c.slug}: ${e}`);
      summary.push({ slug: c.slug, catoid: -1, navoids: 0, programs: -1, matched: 0 });
    }
  }

  console.log(`\n${"=".repeat(60)}\nDone. ${totalPrograms} programs across ${colleges.length} college(s).`);
  console.table(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
