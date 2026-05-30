/**
 * NV catalog prereq scraper
 *
 * Scrapes prerequisite data from each NV college's catalog platform:
 *   - CSN: Acalog (catalog.csn.edu)
 *   - GBC: Custom HTML (gbcnv.edu/catalog/current/courses/)
 *   - TMCC: Courseleaf (catalog.tmcc.edu)
 *   - WNC: Coursedog SPA (catalog.wnc.edu) via Playwright
 *
 * Merges all prereqs into data/nv/prereqs.json keyed by "PREFIX NUMBER".
 * When multiple colleges list the same course, first-seen wins.
 *
 * Usage:
 *   npx tsx scripts/nv/scrape-catalog-prereqs.ts
 *   npx tsx scripts/nv/scrape-catalog-prereqs.ts --college csn
 *   npx tsx scripts/nv/scrape-catalog-prereqs.ts --limit=20
 */

import * as fs from "fs";
import * as path from "path";
import { scrapeCoursedogCatalog } from "../lib/scrape-coursedog";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 6;
const DELAY_MS = 50;
const MAX_PAGES = 40;

interface PrereqEntry {
  text: string;
  courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(url: string, label: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
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

function extractCourseRefs(text: string, selfCode: string): string[] {
  const courses = new Set<string>();
  const codeRegex = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code !== selfCode) courses.add(code);
  }
  return Array.from(courses).sort();
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonTrivialPrereq(text: string): boolean {
  if (!text) return false;
  if (/^none\b/i.test(text)) return false;
  if (/^not applicable/i.test(text)) return false;
  if (/^n\/a$/i.test(text)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// CSN — Acalog (catalog.csn.edu)
// ---------------------------------------------------------------------------

async function scrapeCSN(limit: number): Promise<Record<string, PrereqEntry>> {
  const BASE = "https://catalog.csn.edu";
  const CATOID = 23;
  const NAVOID = 7301;

  console.log("\n📚 CSN (Acalog)");
  console.log(`  ${BASE}, catoid=${CATOID}, navoid=${NAVOID}`);

  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const url =
      `${BASE}/content.php?catoid=${CATOID}&navoid=${NAVOID}` +
      `&filter%5Bitem_type%5D=3&filter%5Bonly_active%5D=1&filter%5Bcpage%5D=${cpage}`;
    const html = await retryFetch(url, `csn-list(${cpage})`);
    const matches = html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) || [];
    const coids = new Set<string>();
    for (const m of matches) {
      const mm = m.match(/coid=(\d+)/);
      if (mm) coids.add(mm[1]);
    }
    console.log(`  page ${cpage}: ${coids.size} courses`);
    if (coids.size === 0) break;
    for (const c of coids) allCoids.add(c);
    await sleep(100);
  }

  let coidList = Array.from(allCoids);
  console.log(`  Total: ${coidList.length} courses`);
  if (limit > 0) coidList = coidList.slice(0, limit);

  const prereqs: Record<string, PrereqEntry> = {};
  let seen = 0;
  let withPrereqs = 0;

  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(
      `${BASE}/preview_course_nopop.php?catoid=${CATOID}&coid=${coid}`,
      `csn-detail(${coid})`,
    );
    seen++;
    if (seen % 200 === 0) console.log(`  ${seen}/${coidList.length} (${withPrereqs} with prereqs)`);
    if (!html) return;

    const titleMatch = html.match(/<h1[^>]*>\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*-/);
    if (!titleMatch) return;
    const prefix = titleMatch[1];
    const number = titleMatch[2];
    const key = `${prefix} ${number}`;

    const prereqMatch = html.match(
      /<strong>\s*Prerequisite(?:s|\(s\))?\s*:?\s*<\/strong>\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
    );
    if (!prereqMatch) return;

    const text = stripHtml(prereqMatch[1]).replace(/[.;,]\s*$/, "").trim();
    if (!isNonTrivialPrereq(text)) return;
    if (prereqs[key]) return;

    prereqs[key] = { text, courses: extractCourseRefs(text, key) };
    withPrereqs++;
  });

  console.log(`  ✓ ${withPrereqs} courses with prereqs (from ${seen} total)`);
  return prereqs;
}

// ---------------------------------------------------------------------------
// GBC — Custom HTML (gbcnv.edu/catalog/current/courses/)
// ---------------------------------------------------------------------------

async function scrapeGBC(limit: number): Promise<Record<string, PrereqEntry>> {
  const BASE = "https://www.gbcnv.edu/catalog/current/courses";

  console.log("\n📚 GBC (Custom HTML)");

  const indexHtml = await retryFetch(`${BASE}/`, "gbc-index");
  let subjects = Array.from(
    new Set(
      (indexHtml.match(/\/catalog\/current\/courses\/([a-z]+)\.html/g) || [])
        .map((m) => m.match(/\/([a-z]+)\.html/)?.[1])
        .filter((s): s is string => !!s && s !== "index"),
    ),
  );

  console.log(`  ${subjects.length} subjects`);
  if (limit > 0) subjects = subjects.slice(0, limit);

  const prereqs: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;

  await pmap(subjects, CONCURRENCY, async (subject) => {
    const html = await retryFetch(`${BASE}/${subject}.html`, `gbc-${subject}`);
    if (!html) return;

    const rows = html.split(/<tr[^>]*>/);
    let currentCode = "";
    for (const row of rows) {
      const codeMatch = row.match(/<td>\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*<\/td>/);
      if (codeMatch) {
        currentCode = `${codeMatch[1]} ${codeMatch[2]}`;
        continue;
      }

      if (!currentCode) continue;

      const prereqMatch = row.match(/<strong>\s*Prerequisite[^:]*:\s*([\s\S]*?)<\/strong>/i);
      if (prereqMatch) {
        const text = stripHtml(prereqMatch[1]).replace(/[.;,]\s*$/, "").trim();
        if (isNonTrivialPrereq(text) && !prereqs[currentCode]) {
          prereqs[currentCode] = { text, courses: extractCourseRefs(text, currentCode) };
          withPrereqs++;
        }
      }
      currentCode = "";
    }
  });

  console.log(`  ✓ ${withPrereqs} courses with prereqs`);
  return prereqs;
}

// ---------------------------------------------------------------------------
// TMCC — Courseleaf (catalog.tmcc.edu)
// ---------------------------------------------------------------------------

async function scrapeTMCC(limit: number): Promise<Record<string, PrereqEntry>> {
  const BASE = "https://catalog.tmcc.edu";

  console.log("\n📚 TMCC (Courseleaf)");

  const indexHtml = await retryFetch(`${BASE}/coursesaz/`, "tmcc-index");
  let subjects = Array.from(
    new Set(
      (indexHtml.match(/\/coursesaz\/([a-z]+)\//g) || [])
        .map((m) => m.match(/\/coursesaz\/([a-z]+)\//)?.[1])
        .filter((s): s is string => !!s),
    ),
  );

  console.log(`  ${subjects.length} subjects`);
  if (limit > 0) subjects = subjects.slice(0, limit);

  const prereqs: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;

  await pmap(subjects, CONCURRENCY, async (subject) => {
    const html = await retryFetch(`${BASE}/coursesaz/${subject}/`, `tmcc-${subject}`);
    if (!html) return;

    const courseBlocks = html.split(/class="courseblock">/);
    for (const block of courseBlocks) {
      const titleMatch = block.match(
        /class="courseblocktitle"[^>]*>\s*<strong>\s*([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)\s/,
      );
      if (!titleMatch) continue;

      const prefix = titleMatch[1];
      const number = titleMatch[2];
      const key = `${prefix} ${number}`;

      const prereqMatch = block.match(
        /Enrollment Requirements:\s*([\s\S]*?)(?:<\/em>|<\/p>)/i,
      );
      if (!prereqMatch) continue;

      const text = stripHtml(prereqMatch[1]).replace(/[.;,]\s*$/, "").trim();
      if (!isNonTrivialPrereq(text) || prereqs[key]) continue;

      prereqs[key] = { text, courses: extractCourseRefs(text, key) };
      withPrereqs++;
    }
  });

  console.log(`  ✓ ${withPrereqs} courses with prereqs`);
  return prereqs;
}

// ---------------------------------------------------------------------------
// WNC — Coursedog SPA (catalog.wnc.edu) via Playwright
// ---------------------------------------------------------------------------

async function scrapeWNC(): Promise<Record<string, PrereqEntry>> {
  console.log("\n📚 WNC (Coursedog via Playwright)");

  const result = await scrapeCoursedogCatalog({
    state: "nv",
    slug: "western-nevada-college",
    catalogDomain: "catalog.wnc.edu",
  });

  if (result.error) {
    console.log(`  ⚠ ${result.error}`);
    return {};
  }

  const prereqs: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;

  for (const course of result.courses) {
    if (!course.prerequisite_text) continue;
    const key = `${course.prefix} ${course.number}`;
    const text = course.prerequisite_text.replace(/\s+/g, " ").trim();
    if (!isNonTrivialPrereq(text) || prereqs[key]) continue;
    prereqs[key] = { text, courses: course.prerequisite_courses };
    withPrereqs++;
  }

  console.log(`  ✓ ${withPrereqs} courses with prereqs (from ${result.coursesCount} total)`);
  return prereqs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1]?.toLowerCase();

  console.log("NV catalog prereq scraper");
  if (limit > 0) console.log(`  Limit: ${limit}`);
  if (collegeFilter) console.log(`  Filter: ${collegeFilter}`);

  const allPrereqs: Record<string, PrereqEntry> = {};
  const colleges: Array<{ name: string; fn: () => Promise<Record<string, PrereqEntry>> }> = [
    { name: "csn", fn: () => scrapeCSN(limit) },
    { name: "gbc", fn: () => scrapeGBC(limit) },
    { name: "tmcc", fn: () => scrapeTMCC(limit) },
    { name: "wnc", fn: () => scrapeWNC() },
  ];

  for (const { name, fn } of colleges) {
    if (collegeFilter && name !== collegeFilter) continue;
    const prereqs = await fn();
    for (const [key, entry] of Object.entries(prereqs)) {
      if (!allPrereqs[key]) allPrereqs[key] = entry;
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(allPrereqs).sort(([a], [b]) => a.localeCompare(b)),
  );

  const outDir = path.join(process.cwd(), "data", "nv");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
