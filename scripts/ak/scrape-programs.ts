/**
 * scrape-programs.ts — degree/program requirements for AK.
 *
 * Ilisagvik uses CleanCatalog at catalog.ilisagvik.edu. We use the shared
 * CleanCatalog template for course requirements, then run a post-pass that
 * fetches each program *area* page (e.g. /accounting, /welding) to extract
 * the human-readable description. CleanCatalog publishes program prose at
 * the area level, not on individual credential pages — without this pass,
 * every program's `description` field stays null.
 *
 * Pantheon (which hosts CleanCatalog) IP-bans pure-fetch traffic; we use
 * Playwright with a 1.5s delay, same as scrape-catalog-prereqs.ts.
 *
 * Usage:
 *   npx tsx scripts/ak/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeCleanCatalogPrograms } from "../lib/scrape-cleancatalog-programs.js";
import type { CollegePrograms } from "../../lib/types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const AREA_DELAY_MS = 1500;
const BASE = "https://catalog.ilisagvik.edu";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Extract program area slug from a credential URL: /accounting/certificate/... → "accounting". */
function areaSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const first = u.pathname.split("/").filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

async function fetchAreaDescription(page: Page, areaSlug: string): Promise<string | null> {
  await page.goto(`${BASE}/${areaSlug}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  return page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const paragraphs = [...main.querySelectorAll("p")]
      .map((p) => (p.textContent || "").trim())
      .filter((t) => t.length > 60 && !t.startsWith("Course Code"));
    if (paragraphs.length === 0) return null;
    // Concatenate the first 2 paragraphs (usually program overview + audience)
    return paragraphs.slice(0, 2).join("\n\n");
  });
}

async function enrichWithAreaDescriptions(data: CollegePrograms): Promise<number> {
  const areas = new Set<string>();
  for (const p of data.programs) {
    const slug = areaSlugFromUrl(p.catalog_url);
    if (slug) areas.add(slug);
  }
  if (areas.size === 0) return 0;

  console.log(`  Enriching ${data.programs.length} programs from ${areas.size} area pages…`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  const descByArea = new Map<string, string | null>();
  for (const slug of areas) {
    try {
      const desc = await fetchAreaDescription(page, slug);
      descByArea.set(slug, desc);
      const status = desc ? `${desc.length} chars` : "no description";
      console.log(`    ${slug}: ${status}`);
    } catch (err) {
      console.log(`    ${slug}: error: ${(err as Error).message}`);
      descByArea.set(slug, null);
    }
    await sleep(AREA_DELAY_MS);
  }
  await browser.close();

  let updated = 0;
  for (const p of data.programs) {
    const slug = areaSlugFromUrl(p.catalog_url);
    if (!slug) continue;
    const desc = descByArea.get(slug);
    if (desc) {
      p.description = desc;
      updated += 1;
    }
  }
  return updated;
}

async function run(
  slug: string,
  scrape: () => Promise<CollegePrograms>,
): Promise<void> {
  console.log(`\n=== ${slug} ===`);
  try {
    const data = await scrape();
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug}.`);
      return;
    }
    const enriched = await enrichWithAreaDescriptions(data);
    console.log(`  Description enrichment: ${enriched}/${data.programs.length} programs`);
    const { matched, unmatched } = applyProgramMatching(data.programs);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", "ak", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

async function main() {
  console.log("AK program scraper");
  // ilisagvik-college (cleancatalog)
  await run("ilisagvik-college", () =>
    scrapeCleanCatalogPrograms({
      collegeSlug: "ilisagvik-college",
      baseUrl: BASE,
      catalogYear: "2026-2027",
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
