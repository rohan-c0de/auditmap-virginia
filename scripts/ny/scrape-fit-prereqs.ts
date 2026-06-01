/**
 * FIT (Fashion Institute of Technology) — CourseLeaf catalog → prereqs
 *
 * FIT publishes per-prefix course pages at
 * catalog.fitnyc.edu/undergraduate/courses/{prefix}/ with inline prereqs:
 *
 *   <div class="courseblock">
 *     <p class="courseblocktitle"><strong>EN&#160;121 &#8212; English Composition</strong></p>
 *     <p class="courseblockdesc">... Prerequisite(s): EN 101 ...</p>
 *   </div>
 *
 * Strategy: fetch the prefix index at /undergraduate/courses/, walk each
 * prefix page, parse Prerequisite(s): blocks from courseblockdesc.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-fit-prereqs.ts
 *   npx tsx scripts/ny/scrape-fit-prereqs.ts --limit=5
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE = "https://catalog.fitnyc.edu/undergraduate/courses";
const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";
const DELAY_MS = 300;

interface PrereqEntry { text: string; courses: string[]; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchPage(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#160;/g, " ")
    .replace(/&#8212;/g, "—")
    .replace(/&#8211;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

const BOILERPLATE = /^(none|not applicable|n\/a|no prerequisites?)\s*\.?\s*$/i;

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

  console.log("FIT catalog prereq scraper");
  console.log(`  Source: ${BASE}\n`);

  const indexHtml = await fetchPage(`${BASE}/`);
  const $idx = cheerio.load(indexHtml);
  const prefixes: string[] = [];
  $idx(`a[href^="/undergraduate/courses/"]`).each((_, el) => {
    const href = $idx(el).attr("href") || "";
    const m = href.match(/\/undergraduate\/courses\/([a-z]{2,5})\/$/i);
    if (m) prefixes.push(m[1]);
  });
  const unique = [...new Set(prefixes)].sort();
  console.log(`  Found ${unique.length} prefixes`);

  const outDir = path.join(process.cwd(), "data", "ny");
  const outPath = path.join(outDir, "prereqs.json");
  let merged: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath)) {
    merged = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Loaded ${Object.keys(merged).length} existing prereqs`);
  }

  let totalNew = 0;
  const toProcess = limit > 0 ? unique.slice(0, limit) : unique;

  for (const prefix of toProcess) {
    try {
      const html = await fetchPage(`${BASE}/${prefix}/`);
      const $ = cheerio.load(html);
      let added = 0;

      $(".courseblock").each((_, block) => {
        const titleEl = $(block).find(".courseblocktitle strong").first();
        const titleRaw = decodeEntities(titleEl.text().trim());
        const codeMatch = titleRaw.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*[—–:]/);
        if (!codeMatch) return;
        const key = `${codeMatch[1]} ${codeMatch[2]}`;

        const descText = $(block).find(".courseblockdesc").text();
        const prereqMatch = descText.match(/Prerequisite\(s\)\s*:\s*([^.]+)\./i);
        if (!prereqMatch) return;

        const text = htmlToText(prereqMatch[1]);
        if (!text || BOILERPLATE.test(text)) return;

        const courses = new Set<string>();
        const codeRe = /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/g;
        let cm: RegExpExecArray | null;
        while ((cm = codeRe.exec(text)) !== null) {
          const c = `${cm[1]} ${cm[2]}`;
          if (c !== key) courses.add(c);
        }

        if (!merged[key]) {
          merged[key] = { text, courses: Array.from(courses).sort() };
          added++;
        }
      });

      if (added > 0) console.log(`  ${prefix.toUpperCase()}: +${added} prereqs`);
      totalNew += added;
      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  ${prefix}: ERROR ${(e as Error).message}`);
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ +${totalNew} new prereqs from FIT (total: ${Object.keys(sorted).length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
