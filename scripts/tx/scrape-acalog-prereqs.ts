/**
 * Texas — Acalog catalog → prereqs scrape
 *
 * Six TX community colleges publish their course catalog via Acalog but
 * don't expose a public class-section endpoint we can scrape. The catalog
 * IS publicly readable, and each course detail page embeds a Prerequisites
 * sentence — that's enough to populate `data/tx/prereqs.json` for these
 * colleges' courses so the semester planner's prereq chain resolves.
 *
 * Six catalogs covered (catoid + course-list navoid discovered via the
 * one-shot probe at scripts/tx/_discover-acalog-navoids.ts on 2026-05-28):
 *
 *   brazosport-college              catoid=36  navoid=6282 (Course Directory)
 *   dallas-college                  catoid=5   navoid=1222 (Course Descriptions)
 *   midland-college                 catoid=21  navoid=4631 (Course Descriptions)
 *   tyler-junior-college            catoid=20  navoid=1234 (Course Descriptions)
 *   lamar-state-college-orange      catoid=6   navoid=554  (Course Descriptions)
 *   wharton-county-junior-college   catoid=2   navoid=54   (Course Descriptions)
 *
 * Closely modeled on scripts/ms/scrape-catalog-prereqs.ts (the MS 6-college
 * version). The catoid is auto-rediscovered each run via discoverAcalogCatoid
 * so the scraper survives the annual catalog rollover; the navoid is
 * hard-coded since Acalog's navigation tree numbers are stable.
 *
 * Output: merges new prereq entries into data/tx/prereqs.json without
 * clobbering existing entries from section scrapers or Coursedog catalogs.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-acalog-prereqs.ts
 *   npx tsx scripts/tx/scrape-acalog-prereqs.ts --limit=20
 *   npx tsx scripts/tx/scrape-acalog-prereqs.ts --college=brazosport-college
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
  "brazosport-college": {
    name: "Brazosport College",
    base: "https://catalog.brazosport.edu",
    catoid: 36,
    navoid: 6282,
  },
  "dallas-college": {
    name: "Dallas College",
    base: "https://dallas.catalog.acalog.com",
    catoid: 5,
    navoid: 1222,
  },
  "midland-college": {
    name: "Midland College",
    base: "https://catalog.midland.edu",
    catoid: 21,
    navoid: 4631,
  },
  "tyler-junior-college": {
    name: "Tyler Junior College",
    base: "https://catalog.tjc.edu",
    catoid: 20,
    navoid: 1234,
  },
  "lamar-state-college-orange": {
    name: "Lamar State College Orange",
    base: "https://catalog.lsco.edu",
    catoid: 6,
    navoid: 554,
  },
  "wharton-county-junior-college": {
    name: "Wharton County Junior College",
    base: "https://wcjc.catalog.acalog.com",
    catoid: 2,
    navoid: 54,
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

  console.log("Texas multi-college Acalog prereq scraper");

  const slugs = collegeFilter ? [collegeFilter] : Object.keys(COLLEGES);

  // Load existing prereqs to merge with
  const outDir = path.join(process.cwd(), "data", "tx");
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
