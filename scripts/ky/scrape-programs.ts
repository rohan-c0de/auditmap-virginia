/**
 * scrape-programs.ts — scrape degree/program requirements for
 * KCTCS (Kentucky Community & Technical College System) from
 * catalog.kctcs.edu (CourseLeaf).
 *
 * KCTCS uses a single centralized catalog covering all 16 colleges.
 * Programs are nested: /programs-of-study/{degree-type}/{program}/
 * so we walk the intermediate category pages first.
 *
 * Usage:
 *   npx tsx scripts/ky/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type { CourseleafProgramConfig } from "../lib/scrape-courseleaf-programs.js";
import type { ProgramRequirement } from "../../lib/types.js";

const BASE = "https://catalog.kctcs.edu";
const INDEX = "/programs-of-study/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function discoverCategories(): Promise<string[]> {
  const res = await fetch(`${BASE}${INDEX}`, {
    headers: { "User-Agent": UA },
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const cats: string[] = [];
  $(`a[href^="${INDEX}"]`).each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href === INDEX || href.endsWith(".pdf")) return;
    if (!href.endsWith("/")) return;
    cats.push(href);
  });
  return [...new Set(cats)].sort();
}

async function main() {
  const outDir = path.join(process.cwd(), "data", "ky", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("KY program scraper (KCTCS CourseLeaf)\n");
  console.log("Discovering degree-type categories...");
  const categories = await discoverCategories();
  console.log(`  Found ${categories.length} categories: ${categories.map((c) => c.replace(INDEX, "").replace(/\/$/, "")).join(", ")}`);

  const configs: CourseleafProgramConfig[] = categories.map((cat) => ({
    collegeSlug: "kctcs",
    baseUrl: BASE,
    programIndexPath: cat,
  }));

  let totalPrograms = 0;
  const allPrograms: ProgramRequirement[] = [];

  for (const config of configs) {
    const label = config.programIndexPath!.replace(INDEX, "").replace(/\/$/, "");
    console.log(`\n--- ${label} ---`);

    try {
      const data = await scrapeCourseleafPrograms(config);
      if (data.programs.length === 0) {
        console.log(`  No programs found, skipping.`);
        continue;
      }
      console.log(`  Found ${data.programs.length} programs`);
      allPrograms.push(...data.programs);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR: ${e}`);
    }
  }

  if (allPrograms.length > 0) {
    const data = {
      college_slug: "kctcs",
      catalog_year: "",
      catalog_url: `${BASE}${INDEX}`,
      scraped_at: new Date().toISOString(),
      programs: allPrograms,
    };

    const { matched, unmatched } = applyProgramMatching(data.programs);
    console.log(`\nMatcher: ${matched} matched to registry slugs, ${unmatched} unmatched`);

    const outPath = path.join(outDir, "kctcs.json");
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`✓ Wrote ${totalPrograms} programs to ${outPath}`);
  }

  console.log(`\nDone. Total: ${totalPrograms} programs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
