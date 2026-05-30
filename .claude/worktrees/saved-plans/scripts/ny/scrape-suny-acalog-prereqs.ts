/**
 * NY/SUNY — Acalog catalog → prereqs scrape
 *
 * Ten SUNY community colleges publish their course catalog via Acalog.
 * Each course detail page embeds a Prerequisites sentence — that's enough
 * to populate `data/ny/prereqs.json` for these colleges' courses so the
 * semester planner's prereq chain resolves.
 *
 * Ten catalogs covered (catoid + course-list navoid probed 2026-05-30):
 *
 *   dutchess-cc       catoid=1   navoid=13     (catalog.sunydutchess.edu)
 *   erie-cc           catoid=27  navoid=2701   (catalog.ecc.edu)
 *   herkimer-cc       catoid=5   navoid=266    (catalog.herkimer.edu)
 *   hudson-valley-cc  catoid=13  navoid=700    (catalog.hvcc.edu)
 *   onondaga-cc       catoid=15  navoid=755    (catalog.sunyocc.edu — HTTP only)
 *   suny-broome-cc    catoid=1   navoid=973    (catalog.sunybroome.edu)
 *   suny-niagara      catoid=36  navoid=2924   (catalog.niagaracc.suny.edu — HTTP only)
 *   suny-orange       catoid=3   navoid=91     (sunyorange.catalog.acalog.com)
 *   suny-ulster       catoid=13  navoid=356    (sunyulster.catalog.acalog.com)
 *   westchester-cc    catoid=57  navoid=10467  (catalog.sunywcc.edu)
 *
 * Modeled on scripts/tx/scrape-acalog-prereqs.ts. catoid is auto-rediscovered
 * each run via discoverAcalogCatoid so the scraper survives the annual catalog
 * rollover; the navoid is hard-coded since Acalog's nav tree numbers are stable.
 *
 * Output: merges new prereq entries into data/ny/prereqs.json without
 * clobbering existing entries from the CUNY Coursedog scraper.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-suny-acalog-prereqs.ts
 *   npx tsx scripts/ny/scrape-suny-acalog-prereqs.ts --limit=20
 *   npx tsx scripts/ny/scrape-suny-acalog-prereqs.ts --college=suny-broome-cc
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
  catoid: number; // fallback — auto-rediscovered each run
  navoid: number;
}

const COLLEGES: Record<string, CollegeConfig> = {
  "dutchess-cc": {
    name: "Dutchess CC",
    base: "https://catalog.sunydutchess.edu",
    catoid: 1,
    navoid: 13,
  },
  "erie-cc": {
    name: "Erie CC",
    base: "https://catalog.ecc.edu",
    catoid: 27,
    navoid: 2701,
  },
  "herkimer-cc": {
    name: "Herkimer County CC",
    base: "https://catalog.herkimer.edu",
    catoid: 5,
    navoid: 266,
  },
  "hudson-valley-cc": {
    name: "Hudson Valley CC",
    base: "https://catalog.hvcc.edu",
    catoid: 13,
    navoid: 700,
  },
  "onondaga-cc": {
    name: "Onondaga CC",
    base: "http://catalog.sunyocc.edu",
    catoid: 15,
    navoid: 755,
  },
  "suny-broome-cc": {
    name: "SUNY Broome",
    base: "https://catalog.sunybroome.edu",
    catoid: 1,
    navoid: 973,
  },
  "suny-niagara": {
    name: "SUNY Niagara",
    base: "http://catalog.niagaracc.suny.edu",
    catoid: 36,
    navoid: 2924,
  },
  "suny-orange": {
    name: "SUNY Orange",
    base: "https://sunyorange.catalog.acalog.com",
    catoid: 3,
    navoid: 91,
  },
  "suny-ulster": {
    name: "SUNY Ulster",
    base: "https://sunyulster.catalog.acalog.com",
    catoid: 13,
    navoid: 356,
  },
  "westchester-cc": {
    name: "Westchester CC",
    base: "https://catalog.sunywcc.edu",
    catoid: 57,
    navoid: 10467,
  },
};

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// All six TX Acalog catalogs sit behind Imperva — bare `fetch` returns
// HTTP 202 with an empty body until the JS challenge is solved. We pop a
// headless Chromium per base URL once, harvest the cookies it sets after
// the challenge clears, and attach them to every subsequent fetch.
const wafCookies = new Map<string, string>();

async function acquireWafCookies(baseUrl: string): Promise<string> {
  const cached = wafCookies.get(baseUrl);
  if (cached) return cached;
  console.log(`  Acquiring WAF cookies via headless browser: ${baseUrl}`);
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
  baseUrl?: string
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };
      if (baseUrl) {
        const cookies = wafCookies.get(baseUrl);
        if (cookies) headers["Cookie"] = cookies;
      }
      const res = await fetch(url, { headers });

      // 202 = Imperva WAF challenge — solve via Playwright, then retry.
      if (res.status === 202 && baseUrl && i === 0) {
        await acquireWafCookies(baseUrl);
        continue;
      }

      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} on ${label}`);
        await sleep(500 * (i + 1));
        continue;
      }
      throw new Error(`HTTP ${res.status} on ${label}`);
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  console.warn(`  ⚠ ${label} failed after ${attempts} attempts: ${lastErr}`);
  return "";
}

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>
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

function listUrl(
  base: string,
  catoid: number,
  navoid: number,
  cpage: number
): string {
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

function extractCoids(html: string): string[] {
  const matches =
    html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) ||
    [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function extractCourseCode(
  html: string
): { prefix: string; number: string } | null {
  const m =
    html.match(/<h1[^>]*>\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*[-–:]/) ||
    html.match(/<title>\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*[-–:]/);
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
 * Extract prereq text from an Acalog detail page. Handles a few common
 * Acalog formats (per MS scraper):
 *   1. `(Prerequisite: text)` parenthesized inline
 *   2. `<strong>Prerequisite(s):</strong> text<br>`
 */
function extractPrereqBlock(html: string): string | null {
  let m = html.match(
    /\(Pre-?requisite(?:s|\(s\))?\s*:\s*([\s\S]{1,2000}?)\)\s/i
  );
  if (m) return m[1];

  m = html.match(
    /(?:<strong>\s*)?Pre-?requisite(?:s|\(s\))?\s*:\s*(?:<\/strong>)?\s*([\s\S]*?)(?:<br\s*\/?>\s*(?:<br|$)|<\/p>|<strong>(?!<\/strong>))/i
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

async function scrapeCollege(
  slug: string,
  config: CollegeConfig,
  limit: number
): Promise<Map<string, PrereqEntry>> {
  console.log(`\n--- ${config.name} (${slug}) ---`);
  console.log(`  Base: ${config.base}`);

  // Probe once; if Imperva is in front, acquire WAF cookies up front so
  // the catoid auto-discovery below has cookies on its first attempt too.
  try {
    const probe = await fetch(config.base, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (probe.status === 202) await acquireWafCookies(config.base);
  } catch {
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
      config.base
    );
    const coids = extractCoids(html);
    if (coids.length === 0) break;
    const before = allCoids.size;
    for (const c of coids) allCoids.add(c);
    if (allCoids.size === before) break; // no new coids — done
    await sleep(100);
  }
  let coidList = Array.from(allCoids);
  console.log(`  ${coidList.length} total coids`);

  if (limit > 0) {
    coidList = coidList.slice(0, limit);
    console.log(`  Limited to ${limit} for smoke test`);
  }

  // Fetch detail pages
  const details: CourseDetail[] = [];
  const codeByCoid = new Map<string, string>();
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(
      detailUrl(config.base, catoid, coid),
      `${slug}/detail(${coid})`,
      3,
      config.base
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
  console.log(
    `  ${prereqs.size} courses with prereqs (${resolvedAnchors} anchor refs resolved)`
  );
  return prereqs;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
    10
  );
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("NY/SUNY multi-college Acalog prereq scraper");

  const slugs = collegeFilter ? [collegeFilter] : Object.keys(COLLEGES);

  // Load existing prereqs to merge with
  const outDir = path.join(process.cwd(), "data", "ny");
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
      console.log(
        `  +${added} new (${collegePrereqs.size - added} already known)`
      );
    } catch (e) {
      console.error(`  ⚠ ${slug} failed: ${e}`);
      console.error(`  Continuing with remaining colleges...`);
    }
  }

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
