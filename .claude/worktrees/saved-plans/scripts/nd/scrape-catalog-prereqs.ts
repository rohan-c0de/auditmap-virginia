/**
 * scrape-catalog-prereqs.ts — North Dakota community college catalog prereqs.
 *
 * NDUS course-search (PeopleSoft Community Access) does not expose
 * prerequisite text, so we scrape per-college catalogs and merge results.
 * Because NDUS enforces Common Course Numbering (CCN) under the GERTA
 * agreement, ENGL 110 at BSC = ENGL 110 at every NDUS college — so one
 * prereq dict serves all 5 NDUS community colleges. First-wins per course
 * code.
 *
 * Platforms covered now:
 *   • Bismarck State College — CourseLeaf
 *       catalog.bismarckstate.edu/catalog/course-descriptions/{subj}/
 *   • Williston State College — Acalog
 *       catalog.willistonstate.edu/content.php?catoid=1&navoid=24&…
 *
 * Deferred (Cloudflare WAF on direct HTTP — needs Playwright follow-up):
 *   • Dakota College at Bottineau — Cleancatalog
 *   • North Dakota State College of Science — Cleancatalog
 *
 * Lake Region State College publishes catalog as PDF only — separate
 * follow-up (smallest CC, lowest priority).
 *
 * Output: data/nd/prereqs.json keyed by "PREFIX NUMBER".
 *
 * Usage:
 *   npx tsx scripts/nd/scrape-catalog-prereqs.ts
 *   npx tsx scripts/nd/scrape-catalog-prereqs.ts --college=bsc
 *   npx tsx scripts/nd/scrape-catalog-prereqs.ts --limit=20   # smoke
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 80;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface PrereqEntry {
  text: string;
  courses: string[];
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function retryFetch(url: string, label: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return ""; // 404 — silently skip
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  console.error(`  ${label} failed after ${attempts}: ${lastErr}`);
  return "";
}

async function pmap<T, R>(items: T[], n: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------------

function htmlDecode(s: string): string {
  return s
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanPrereqText(raw: string): string {
  let text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "");
  text = htmlDecode(text).replace(/\s+/g, " ").trim();
  text = text.replace(/[.;,]\s*$/, "").trim();
  return text;
}

// NDUS course codes: 2-4 letter prefix + 3-digit number, optional letter.
const NDUS_CODE_REGEX = /\b([A-Z]{2,4})\s*(\d{3}[A-Z]?)\b/g;

function extractCodes(text: string, selfPrefix: string, selfNumber: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(NDUS_CODE_REGEX.source, "g");
  while ((m = re.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code === `${selfPrefix} ${selfNumber}`) continue;
    out.add(code);
  }
  return Array.from(out).sort();
}

function isNoise(text: string): boolean {
  return (
    /^none\b/i.test(text) ||
    /^not applicable/i.test(text) ||
    text.length < 3
  );
}

// ---------------------------------------------------------------------------
// BSC — CourseLeaf (catalog.bismarckstate.edu)
// ---------------------------------------------------------------------------

const BSC_BASE = "https://catalog.bismarckstate.edu";

async function discoverBscSubjects(): Promise<string[]> {
  const html = await retryFetch(`${BSC_BASE}/catalog/course-descriptions/`, "bsc-index");
  if (!html) return [];
  const matches = html.match(/\/catalog\/course-descriptions\/([a-z]{2,5})\//g) || [];
  const subs = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/course-descriptions\/([a-z]{2,5})\//);
    if (mm) subs.add(mm[1]);
  }
  return Array.from(subs).sort();
}

interface CourseLeafBlock {
  prefix: string;
  number: string;
  prereqText: string | null;
}

function parseBscSubjectPage(html: string): CourseLeafBlock[] {
  const blocks: CourseLeafBlock[] = [];
  // Each course is wrapped in <div class="courseblock"> ... </div>
  // Title pattern: <strong>PREFIX NUMBER. Title<br/></strong>
  // Description: <p class="courseblockdesc">...Credits: N<br/>Prerequisite: ...<br/>
  const blockRegex = /<div class="courseblock">([\s\S]*?)<\/div>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRegex.exec(html)) !== null) {
    const block = bm[1];
    const titleMatch = block.match(
      /<strong>\s*([A-Z]{2,4})\s+(\d{3}[A-Z]?)\.\s/,
    );
    if (!titleMatch) continue;
    const prefix = titleMatch[1];
    const number = titleMatch[2];

    // Prereq line: "Prerequisite: ... <br/>" or "Prerequisites: ..."
    // CourseLeaf uses descriptive sentences with embedded course links.
    const prereqMatch = block.match(
      /Prerequisite(?:s)?:\s*([\s\S]*?)<br\s*\/?>/i,
    );
    const prereqText = prereqMatch ? cleanPrereqText(prereqMatch[1]) : null;
    blocks.push({ prefix, number, prereqText });
  }
  return blocks;
}

async function scrapeBsc(limit: number): Promise<Record<string, PrereqEntry>> {
  console.log("\n── BSC (CourseLeaf) ──────────────────────");
  const subjects = await discoverBscSubjects();
  console.log(`  Discovered ${subjects.length} subject pages`);
  const subList = limit > 0 ? subjects.slice(0, Math.min(limit, subjects.length)) : subjects;

  const all: Record<string, PrereqEntry> = {};
  let totalCourses = 0;
  let totalWithPrereqs = 0;

  await pmap(subList, CONCURRENCY, async (subj) => {
    const html = await retryFetch(
      `${BSC_BASE}/catalog/course-descriptions/${subj}/`,
      `bsc/${subj}`,
    );
    if (!html) return;
    const blocks = parseBscSubjectPage(html);
    totalCourses += blocks.length;
    for (const b of blocks) {
      if (!b.prereqText) continue;
      if (isNoise(b.prereqText)) continue;
      const key = `${b.prefix} ${b.number}`;
      if (all[key]) continue;
      all[key] = {
        text: b.prereqText,
        courses: extractCodes(b.prereqText, b.prefix, b.number),
      };
      totalWithPrereqs++;
    }
  });

  console.log(`  ${totalCourses} courses → ${totalWithPrereqs} with prereqs`);
  return all;
}

// ---------------------------------------------------------------------------
// WSC — Acalog (catalog.willistonstate.edu)
// ---------------------------------------------------------------------------

const WSC_BASE = "https://catalog.willistonstate.edu";
const WSC_CATOID = 1;
const WSC_NAVOID = 24; // Course Descriptions

function wscListUrl(cpage: number): string {
  return (
    `${WSC_BASE}/content.php?catoid=${WSC_CATOID}` +
    `&navoid=${WSC_NAVOID}` +
    `&filter%5Bitem_type%5D=3` +
    `&filter%5Bonly_active%5D=1` +
    `&filter%5B3%5D=1` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function wscDetailUrl(coid: string): string {
  return `${WSC_BASE}/preview_course_nopop.php?catoid=${WSC_CATOID}&coid=${coid}`;
}

function extractWscCoids(html: string): string[] {
  const matches = html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function parseWscDetail(html: string): { prefix: string; number: string; text: string; courses: string[] } | null {
  const titleMatch = html.match(/<title>\s*([A-Z]{2,4})\s+(\d{3}[A-Z]?)\s*-/);
  if (!titleMatch) return null;
  const prefix = titleMatch[1];
  const number = titleMatch[2];
  const prereqMatch = html.match(
    /<strong>\s*Prerequisite(?:s|\(s\))?\s*:?\s*<\/strong>([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
  );
  if (!prereqMatch) return null;
  const text = cleanPrereqText(prereqMatch[1]);
  if (!text || isNoise(text)) return null;
  return { prefix, number, text, courses: extractCodes(text, prefix, number) };
}

async function scrapeWsc(limit: number): Promise<Record<string, PrereqEntry>> {
  console.log("\n── WSC (Acalog) ──────────────────────────");
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= 20; cpage++) {
    const html = await retryFetch(wscListUrl(cpage), `wsc list cpage=${cpage}`);
    const coids = extractWscCoids(html);
    if (coids.length === 0) break;
    for (const c of coids) allCoids.add(c);
    console.log(`  cpage=${cpage}: ${coids.length} coids (running total ${allCoids.size})`);
    await sleep(100);
  }
  let coidList = Array.from(allCoids);
  if (limit > 0) coidList = coidList.slice(0, limit);
  console.log(`  Fetching ${coidList.length} detail pages...`);

  const all: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(wscDetailUrl(coid), `wsc coid=${coid}`);
    if (!html) return;
    const parsed = parseWscDetail(html);
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (all[key]) return;
    all[key] = { text: parsed.text, courses: parsed.courses };
    withPrereqs++;
  });
  console.log(`  ${coidList.length} courses → ${withPrereqs} with prereqs`);
  return all;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);
  const collegeArg = args.find((a) => a.startsWith("--college="))?.split("=")[1] || "all";

  console.log("ND catalog prereq scraper");
  console.log(`  scope: ${collegeArg}  limit: ${limit || "none"}`);

  const merged: Record<string, PrereqEntry> = {};
  let bscCount = 0, wscCount = 0;

  if (collegeArg === "all" || collegeArg === "bsc") {
    const bsc = await scrapeBsc(limit);
    bscCount = Object.keys(bsc).length;
    for (const [k, v] of Object.entries(bsc)) {
      if (!merged[k]) merged[k] = v;
    }
  }
  if (collegeArg === "all" || collegeArg === "wsc") {
    const wsc = await scrapeWsc(limit);
    wscCount = Object.keys(wsc).length;
    for (const [k, v] of Object.entries(wsc)) {
      if (!merged[k]) merged[k] = v;
    }
  }

  const outDir = path.join(process.cwd(), "data", "nd");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");

  console.log(`\n${"=".repeat(50)}`);
  console.log(`BSC: ${bscCount} courses with prereqs`);
  console.log(`WSC: ${wscCount} courses with prereqs`);
  console.log(`Merged: ${Object.keys(merged).length} unique course codes`);
  console.log(`→ ${outPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
