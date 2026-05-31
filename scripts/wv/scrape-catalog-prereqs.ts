/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes six West Virginia community college Acalog catalogs to extract
 * prerequisite text. All six instances are behind an AWS WAF that issues a
 * 202 + JS challenge to bare HTTP clients; the scraper acquires a session
 * cookie per domain via Playwright (headless Chromium) and then uses that
 * cookie for all subsequent fetch() calls.
 *
 * Colleges covered:
 *   - Pierpont Community & Technical College  (catalog.pierpont.edu)
 *   - BridgeValley CTC                        (catalog.bridgevalley.edu)
 *   - Bluefield State University              (catalog.bluefieldstate.edu)
 *   - WV Northern Community College           (catalog.wvncc.edu)
 *   - Southern WV Community & Technical College (catalog.southernwv.edu)
 *   - New River Community & Technical College (catalog.newriver.edu)
 *
 * Flow per college:
 *   1. Acquire WAF session cookies via Playwright (one browser launch per domain).
 *   2. Paginate content.php?catoid=X&navoid=Y&filter[cpage]=N to collect coids.
 *   3. Fetch each preview_course_nopop.php detail page with WAF cookies.
 *   4. Extract <strong>Prerequisite(s):</strong> text.
 *   5. Merge — first college to publish a code wins.
 *   6. Write data/wv/prereqs.json keyed by "${PREFIX} ${NUMBER}".
 *
 * Usage:
 *   npx tsx scripts/wv/scrape-catalog-prereqs.ts
 *   npx tsx scripts/wv/scrape-catalog-prereqs.ts --limit=10   # smoke test
 */

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

interface CollegeConfig {
  slug: string;
  name: string;
  base: string;
  catoid: number;
  navoid: number;
}

const COLLEGES: CollegeConfig[] = [
  {
    slug: "pierpont-community-and-technical-college",
    name: "Pierpont C&TC",
    base: "https://catalog.pierpont.edu",
    catoid: 13,
    navoid: 2272,
  },
  {
    slug: "bridgevalley-community-and-technical-college",
    name: "BridgeValley CTC",
    base: "https://catalog.bridgevalley.edu",
    catoid: 36,
    navoid: 799,
  },
  {
    slug: "bluefield-state-university",
    name: "Bluefield State University",
    base: "https://catalog.bluefieldstate.edu",
    catoid: 14,
    navoid: 2744,
  },
  {
    slug: "west-virginia-northern-community-college",
    name: "WV Northern CC",
    base: "https://catalog.wvncc.edu",
    catoid: 17,
    navoid: 1181,
  },
  {
    slug: "southern-west-virginia-community-and-technical-college",
    name: "Southern WV CTC",
    base: "https://catalog.southernwv.edu",
    catoid: 11,
    navoid: 405,
  },
  {
    slug: "new-river-community-and-technical-college",
    name: "New River CTC",
    base: "https://catalog.newriver.edu",
    catoid: 2,
    navoid: 60,
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 60;
const MAX_PAGES = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqEntry {
  text: string;
  courses: string[];
}

// ---------------------------------------------------------------------------
// WAF cookie cache + acquisition
// ---------------------------------------------------------------------------

// Per-domain WAF session cookies acquired via Playwright.
const wafCookies = new Map<string, string>();

async function acquireWafCookies(baseUrl: string): Promise<string> {
  const cached = wafCookies.get(baseUrl);
  if (cached) return cached;

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const cookies = await ctx.cookies();
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    wafCookies.set(baseUrl, cookieStr);
    return cookieStr;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  baseUrl: string,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };
      const cookies = wafCookies.get(baseUrl);
      if (cookies) headers["Cookie"] = cookies;

      const res = await fetch(url, { headers });

      // 202 = AWS WAF JS challenge — acquire cookies via browser and retry
      if (res.status === 202 && i === 0) {
        console.log(`    WAF challenge on ${label}, acquiring cookies via browser...`);
        await acquireWafCookies(baseUrl);
        continue;
      }

      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return ""; // 404 — course probably delisted; skip silently
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Concurrency primitive
// ---------------------------------------------------------------------------

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
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
// Catalog endpoints
// ---------------------------------------------------------------------------

function listUrl(college: CollegeConfig, cpage: number): string {
  return (
    `${college.base}/content.php?catoid=${college.catoid}` +
    `&catoid=${college.catoid}` +
    `&navoid=${college.navoid}` +
    `&filter%5Bitem_type%5D=3` +
    `&filter%5Bonly_active%5D=1` +
    `&filter%5B3%5D=1` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function detailUrl(college: CollegeConfig, coid: string): string {
  return `${college.base}/preview_course_nopop.php?catoid=${college.catoid}&coid=${coid}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function extractCoids(html: string): string[] {
  const matches =
    html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function parseDetailPage(
  html: string,
): { prefix: string; number: string; text: string; courses: string[] } | null {
  const titleMatch = html.match(/<title>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*-/);
  if (!titleMatch) return null;
  const prefix = titleMatch[1].toUpperCase();
  const number = titleMatch[2];

  const prereqMatch = html.match(
    /<strong>\s*Prerequisite(?:s|\(s\))?\s*:?\s*<\/strong>\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
  );
  if (!prereqMatch) return null;

  let text = prereqMatch[1]
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

  text = text.replace(/[.;,]\s*$/, "").trim();

  if (!text) return null;
  if (/^none\b/i.test(text)) return null;
  if (/^not applicable/i.test(text)) return null;

  const courses = new Set<string>();
  const codeRegex = /\b([A-Z]{3,5})\s*(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code === `${prefix} ${number}`) continue;
    courses.add(code);
  }

  return { prefix, number, text, courses: Array.from(courses).sort() };
}

// ---------------------------------------------------------------------------
// Per-college scrape
// ---------------------------------------------------------------------------

async function scrapeCollege(
  college: CollegeConfig,
  limit: number,
): Promise<Record<string, PrereqEntry>> {
  console.log(`\n  [${college.name}] ${college.base} catoid=${college.catoid} navoid=${college.navoid}`);

  // Phase 1: collect coids — WAF cookies acquired lazily on first 202
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const html = await retryFetch(
      listUrl(college, cpage),
      `${college.slug}/list(cpage=${cpage})`,
      college.base,
    );
    const coids = extractCoids(html);
    const prevSize = allCoids.size;
    for (const c of coids) allCoids.add(c);
    const newCount = allCoids.size - prevSize;
    console.log(`    cpage=${cpage}: ${coids.length} coids (${newCount} new)`);
    // Stop when the page is empty or all coids were already seen (pagination loop)
    if (coids.length === 0 || newCount === 0) break;
    await sleep(100);
  }

  let coidList = Array.from(allCoids);
  console.log(`    Total unique coids: ${coidList.length}`);
  if (limit > 0) {
    coidList = coidList.slice(0, limit);
    console.log(`    Limited to first ${limit} for smoke test`);
  }

  // Phase 2: detail pages
  const prereqs: Record<string, PrereqEntry> = {};
  let seen = 0;
  let withPrereqs = 0;

  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(
      detailUrl(college, coid),
      `${college.slug}/detail(${coid})`,
      college.base,
    );
    seen++;
    if (seen % 100 === 0) {
      console.log(`    ${seen}/${coidList.length} courses (${withPrereqs} with prereqs)`);
    }
    if (!html) return;
    const parsed = parseDetailPage(html);
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (prereqs[key]) return; // first wins within this college
    prereqs[key] = { text: parsed.text, courses: parsed.courses };
    withPrereqs++;
  });

  console.log(`    Parsed ${seen}/${coidList.length} detail pages`);
  console.log(`    Extracted prereqs for ${Object.keys(prereqs).length} courses`);
  return prereqs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
    10,
  );

  console.log("WV catalog prereq scraper (6 Acalog catalogs, WAF bypass via Playwright)");
  if (limit > 0) console.log(`  Smoke-test mode: --limit=${limit} per college`);

  const merged: Record<string, PrereqEntry> = {};

  for (const college of COLLEGES) {
    const result = await scrapeCollege(college, limit);
    let added = 0;
    for (const [key, entry] of Object.entries(result)) {
      if (!merged[key]) {
        merged[key] = entry;
        added++;
      }
    }
    console.log(`    +${added} new keys (merged total: ${Object.keys(merged).length})`);
  }

  console.log(`\nTotal prereqs across all colleges: ${Object.keys(merged).length}`);

  const outDir = path.join(process.cwd(), "data", "wv");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`✓ Wrote ${Object.keys(merged).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
