/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes Acalog catalogs from 6 Mississippi community colleges to extract
 * prerequisite text. Unlike CT/TN (single catalog), MS has per-college
 * Acalog instances with varying prereq label formats:
 *
 *   - MGCCC:     `Prerequisite:` inline in description paragraph
 *   - Hinds:     `(Prerequisites:` parenthesized, inline
 *   - East MS:   `<strong>Prerequisites:</strong>` separated by `<br><br>`
 *   - JCJC:      `<strong>Prerequisite(s):</strong>` separated
 *   - Meridian:  `Prerequisite: None` separated (filter "None")
 *   - Northwest: `<strong>Prerequisite(s):</strong>` separated
 *
 * All colleges use Mississippi's common course numbering (4-letter prefix +
 * 4-digit number, e.g. ENG 1113). The scraper deduplicates by course code
 * across colleges — first college to provide a prereq wins.
 *
 * Flow:
 *   1. For each college, auto-discover catoid + navoid.
 *   2. Paginate the course list, collect coids.
 *   3. Fetch each detail page, extract prereqs.
 *   4. Merge into a single data/ms/prereqs.json.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-catalog-prereqs.ts
 *   npx tsx scripts/ms/scrape-catalog-prereqs.ts --limit=20
 *   npx tsx scripts/ms/scrape-catalog-prereqs.ts --college=mgccc
 */

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { discoverAcalogCatoid } from "../lib/discover-catalog.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 60;
const MAX_PAGES = 25;

interface CollegeConfig {
  name: string;
  base: string;
  catoid: number;  // fallback — auto-discovered
  navoid: number;
}

const COLLEGES: Record<string, CollegeConfig> = {
  mgccc: {
    name: "Mississippi Gulf Coast CC",
    base: "https://catalog.mgccc.edu",
    catoid: 32,
    navoid: 3170,
  },
  hinds: {
    name: "Hinds CC",
    base: "https://catalog.hindscc.edu",
    catoid: 22,
    navoid: 1047,
  },
  eastms: {
    name: "East Mississippi CC",
    base: "https://catalog.eastms.edu",
    catoid: 6,
    navoid: 583,
  },
  jcjc: {
    name: "Jones County Junior College",
    base: "https://catalog.jcjc.edu",
    catoid: 9,
    navoid: 653,
  },
  meridian: {
    name: "Meridian CC",
    base: "https://catalog.meridiancc.edu",
    catoid: 6,
    navoid: 140,
  },
  northwest: {
    name: "Northwest Mississippi CC",
    base: "https://catalog.northwestms.edu",
    catoid: 8,
    navoid: 395,
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqEntry {
  text: string;
  courses: string[];
}

interface CourseDetail {
  coid: string;
  prefix: string;
  number: string;
  html: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-domain WAF cookies acquired via Playwright.
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

async function retryFetch(
  url: string,
  label: string,
  attempts = 3,
  baseUrl?: string,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };
      if (baseUrl) {
        const cookies = wafCookies.get(baseUrl);
        if (cookies) headers["Cookie"] = cookies;
      }
      const res = await fetch(url, { headers });

      // 202 = Imperva WAF challenge — acquire cookies via Playwright and retry
      if (res.status === 202 && baseUrl && i === 0) {
        console.log(`  WAF challenge on ${label}, acquiring cookies via browser...`);
        await acquireWafCookies(baseUrl);
        continue;
      }

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
// Acalog endpoints
// ---------------------------------------------------------------------------

function listUrl(base: string, catoid: number, navoid: number, cpage: number): string {
  return (
    `${base}/content.php?catoid=${catoid}` +
    `&catoid=${catoid}` +
    `&navoid=${navoid}` +
    `&filter%5Bitem_type%5D=3` +
    `&filter%5Bonly_active%5D=1` +
    `&filter%5B3%5D=1` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function detailUrl(base: string, catoid: number, coid: string): string {
  return `${base}/preview_course_nopop.php?catoid=${catoid}&coid=${coid}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function extractCoids(html: string): string[] {
  const matches = html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function extractCourseCode(html: string): { prefix: string; number: string } | null {
  // Try <h1> first, then <title>
  const m = html.match(/<h1[^>]*>\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*-/) ||
            html.match(/<title>\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*-/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2] };
}

function htmlToText(raw: string): string {
  return raw
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
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

/**
 * Extract prereq text from an Acalog detail page. Handles multiple MS
 * college formats:
 *   1. `<strong>Prerequisite(s):</strong> text<br>`
 *   2. `Prerequisite: text<br>` (inline, no strong)
 *   3. `(Prerequisites: text)` (parenthesized, inline)
 */
function extractPrereqBlock(html: string): string | null {
  // Pattern 1: (Prerequisites: ...) parenthesized inline (Hinds format).
  // Match up to the first `)` after stripping the opening `(Prerequisite:`.
  let m = html.match(
    /\(Pre-?requisite(?:s|\(s\))?\s*:\s*([\s\S]{1,2000}?)\)\s/i,
  );
  if (m) return m[1];

  // Pattern 2: <strong>Prerequisite(s):</strong> ... up to <br> or </p> or next <strong>
  m = html.match(
    /(?:<strong>\s*)?Pre-?requisite(?:s|\(s\))?\s*:\s*(?:<\/strong>)?\s*([\s\S]*?)(?:<br\s*\/?>\s*(?:<br|$)|<\/p>|<strong>(?!<\/strong>))/i,
  );
  if (m) return m[1];

  return null;
}

function extractAnchorCoids(htmlBlock: string): string[] {
  const matches = htmlBlock.match(/coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

const BOILERPLATE_RE =
  /^(none|not applicable|n\/a|no prerequisites?)\s*\.?\s*$/i;

// ---------------------------------------------------------------------------
// Per-college scrape
// ---------------------------------------------------------------------------

async function scrapeCollege(
  slug: string,
  config: CollegeConfig,
  limit: number,
): Promise<Map<string, PrereqEntry>> {
  console.log(`\n--- ${config.name} (${slug}) ---`);
  console.log(`  Base: ${config.base}`);

  // Pre-acquire WAF cookies before any fetch (including catoid discovery)
  try {
    const probe = await fetch(config.base, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (probe.status === 202) {
      console.log(`  WAF detected, acquiring cookies via browser...`);
      await acquireWafCookies(config.base);
    }
  } catch {
    console.log(`  Probe failed (network error), trying WAF acquisition anyway...`);
    await acquireWafCookies(config.base);
  }

  let catoid = config.catoid;
  try {
    const discovered = await discoverAcalogCatoid(config.base, config.catoid);
    if (discovered > 0) catoid = discovered;
  } catch {
    // fall through to fallback
  }
  console.log(`  catoid=${catoid} navoid=${config.navoid}`);

  // Paginate course list
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const html = await retryFetch(
      listUrl(config.base, catoid, config.navoid, cpage),
      `${slug}/list(cpage=${cpage})`,
      3,
      config.base,
    );
    const coids = extractCoids(html);
    if (coids.length === 0) break;
    for (const c of coids) allCoids.add(c);
    await sleep(100);
  }
  let coidList = Array.from(allCoids);
  console.log(`  ${coidList.length} total coids`);

  if (limit > 0) {
    coidList = coidList.slice(0, limit);
    console.log(`  Limited to ${limit} for smoke test`);
  }

  // Fetch detail pages + build coid index
  const details: CourseDetail[] = [];
  const codeByCoid = new Map<string, string>();
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(
      detailUrl(config.base, catoid, coid),
      `${slug}/detail(${coid})`,
      3,
      config.base,
    );
    if (!html) return;
    const code = extractCourseCode(html);
    if (!code) return;
    details.push({ coid, prefix: code.prefix, number: code.number, html });
    codeByCoid.set(coid, `${code.prefix} ${code.number}`);
  });
  console.log(`  Fetched ${details.length} course pages`);

  // Parse prereqs
  const prereqs = new Map<string, PrereqEntry>();
  let resolvedAnchors = 0;
  for (const d of details) {
    const block = extractPrereqBlock(d.html);
    if (!block) continue;

    const text = htmlToText(block);
    if (!text || BOILERPLATE_RE.test(text)) continue;

    const courses = new Set<string>();
    const codeRegex = /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/g;
    let m: RegExpExecArray | null;
    while ((m = codeRegex.exec(text)) !== null) {
      const code = `${m[1]} ${m[2]}`;
      if (code !== `${d.prefix} ${d.number}`) courses.add(code);
    }

    for (const anchorCoid of extractAnchorCoids(block)) {
      const resolved = codeByCoid.get(anchorCoid);
      if (resolved && resolved !== `${d.prefix} ${d.number}`) {
        courses.add(resolved);
        resolvedAnchors++;
      }
    }

    const key = `${d.prefix} ${d.number}`;
    if (!prereqs.has(key)) {
      prereqs.set(key, { text, courses: Array.from(courses).sort() });
    }
  }
  console.log(`  ${prereqs.size} courses with prereqs (${resolvedAnchors} anchor refs resolved)`);
  return prereqs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1];

  console.log("Mississippi multi-college Acalog prereq scraper");

  const slugs = collegeFilter
    ? [collegeFilter]
    : Object.keys(COLLEGES);

  // Load existing prereqs to merge with
  const outDir = path.join(process.cwd(), "data", "ms");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  let merged: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath)) {
    merged = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Loaded ${Object.keys(merged).length} existing prereqs`);
  }

  for (const slug of slugs) {
    const config = COLLEGES[slug];
    if (!config) {
      console.error(`Unknown college: ${slug}`);
      continue;
    }
    try {
      const collegePrereqs = await scrapeCollege(slug, config, limit);
      let added = 0;
      for (const [key, entry] of collegePrereqs) {
        if (!merged[key]) {
          merged[key] = entry;
          added++;
        }
      }
      console.log(`  +${added} new (${collegePrereqs.size - added} already known)`);
    } catch (e) {
      console.error(`  ⚠ ${slug} failed: ${e}`);
      console.error(`  Continuing with remaining colleges...`);
    }
  }

  // Sort and write
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) {
    sorted[key] = merged[key];
  }

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
