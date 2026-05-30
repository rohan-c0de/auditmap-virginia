/**
 * Nassau CC — OmniUpdate HTML catalog → prereqs
 *
 * Nassau publishes per-subject course pages at
 * collegecatalog.ncc.edu/current/courses/{SUBJ}.html with inline prereqs:
 *
 *   <h3><a id="101">ACC 101</a> - Accounting I</h3>
 *   <p><strong>Prerequisites: </strong><a href="...">ACC 101</a> with ...</p>
 *
 * Strategy: fetch the subject index, walk each subject page, parse
 * Prerequisites:/Corequisites: blocks.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-nassau-prereqs.ts
 *   npx tsx scripts/ny/scrape-nassau-prereqs.ts --limit=5
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE = "https://collegecatalog.ncc.edu/current/courses";
const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";
const DELAY_MS = 300;

interface PrereqEntry { text: string; courses: string[]; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchPage(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

const BOILERPLATE = /^(none|not applicable|n\/a|no prerequisites?)\s*\.?\s*$/i;

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

  console.log("Nassau CC catalog prereq scraper");
  console.log(`  Source: ${BASE}\n`);

  const indexHtml = await fetchPage(`${BASE}/`);
  const $idx = cheerio.load(indexHtml);
  const subjects: string[] = [];
  $idx(`a[href$=".html"]`).each((_, el) => {
    const href = $idx(el).attr("href") || "";
    const m = href.match(/\/([A-Z]{2,5})\.html$/);
    if (m) subjects.push(m[1]);
  });
  if (subjects.length === 0) {
    const fromGrep = indexHtml.match(/href="[^"]*\/([A-Z]{2,5})\.html"/g) || [];
    for (const m of fromGrep) {
      const mm = m.match(/([A-Z]{2,5})\.html/);
      if (mm) subjects.push(mm[1]);
    }
  }
  const unique = [...new Set(subjects)].sort();
  console.log(`  Found ${unique.length} subjects`);

  const outDir = path.join(process.cwd(), "data", "ny");
  const outPath = path.join(outDir, "prereqs.json");
  let merged: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath)) {
    merged = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Loaded ${Object.keys(merged).length} existing prereqs`);
  }

  let totalNew = 0;
  const toProcess = limit > 0 ? unique.slice(0, limit) : unique;

  for (const subj of toProcess) {
    try {
      const html = await fetchPage(`${BASE}/${subj}.html`);
      const $ = cheerio.load(html);
      let added = 0;

      $("h3").each((_, h3) => {
        const heading = $(h3).text().trim();
        const codeMatch = heading.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*[-–:]/);
        if (!codeMatch) return;
        const key = `${codeMatch[1]} ${codeMatch[2]}`;

        const nextP = $(h3).nextAll("p").first();
        const strongText = nextP.find("strong").first().text().trim();
        if (!/prerequisite|corequisite/i.test(strongText)) return;

        const rawHtml = nextP.html() || "";
        const afterStrong = rawHtml.replace(/.*?<\/strong>\s*/i, "");
        const text = htmlToText(afterStrong);
        if (!text || BOILERPLATE.test(text)) return;

        const courses = new Set<string>();
        const codeRe = /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/g;
        let cm: RegExpExecArray | null;
        while ((cm = codeRe.exec(text)) !== null) {
          const c = `${cm[1]} ${cm[2]}`;
          if (c !== key) courses.add(c);
        }
        nextP.find("a[href]").each((_, a) => {
          const linkText = $(a).text().trim();
          const lm = linkText.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
          if (lm) {
            const c = `${lm[1]} ${lm[2]}`;
            if (c !== key) courses.add(c);
          }
        });

        if (!merged[key]) {
          merged[key] = { text, courses: Array.from(courses).sort() };
          added++;
        }
      });

      if (added > 0) console.log(`  ${subj}: +${added} prereqs`);
      totalNew += added;
      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  ${subj}: ERROR ${(e as Error).message}`);
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ +${totalNew} new prereqs from Nassau (total: ${Object.keys(sorted).length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
