/**
 * scrape-catalog-prereqs.ts — MN MnSCU Acalog + SmartCatalogIQ catalog
 * prerequisite scraper.
 *
 * The MN eservices SIS course search (scrape-mn-eservices.ts) doesn't
 * include prereq text. This scraper fills the gap from each college's
 * public Acalog or SmartCatalogIQ catalog.
 *
 * Coverage:
 *   Acalog (6 colleges):
 *     - anokatech       catoid=6  courses navoid=296
 *     - anokaramsey     catoid=3  courses navoid=156
 *     - century         catoid=23 courses navoid=1601
 *     - dctc            catoid=2  courses navoid=47
 *     - inverhills      catoid=2  courses navoid=44
 *     - saintpaul       catoid=5  courses navoid=201
 *   SmartCatalogIQ (2 colleges):
 *     - hennepintech    https://hennepintech.smartcatalogiq.com/en/2026-2027/catalog
 *     - normandale      https://normandale.smartcatalogiq.com/2025-2026/course-catalog
 *
 * Output: data/mn/prereqs.json — single map keyed by "PREFIX NUMBER" with
 * { text, courses, source } per entry. `source` is the contributing MN
 * college slug. MnSCU enforces common course numbering across the system,
 * so the same code generally means the same course; when multiple colleges
 * publish slightly different prereq text for the same code, first writer
 * wins.
 *
 * Usage:
 *   npx tsx scripts/mn/scrape-catalog-prereqs.ts
 *   npx tsx scripts/mn/scrape-catalog-prereqs.ts --college century
 *   npx tsx scripts/mn/scrape-catalog-prereqs.ts --limit-pages 2  # smoke
 */
import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 80;
const MAX_PAGES = 30;

interface PrereqEntry {
  text: string;
  courses: string[];
  source: string;
}

type Platform = "acalog" | "smartcatalogiq";

interface CollegeCatalog {
  slug: string;
  platform: Platform;
  // Acalog
  baseUrl?: string;
  catoid?: number;
  navoid?: number;
  // SmartCatalogIQ
  catalogBase?: string;
  /** Path under catalogBase that hosts the course index. Default "course-outlines". */
  coursesPath?: string;
}

const COLLEGES: CollegeCatalog[] = [
  // Acalog
  { slug: "anoka-technical-college", platform: "acalog", baseUrl: "https://catalog.anokatech.edu", catoid: 6, navoid: 296 },
  { slug: "anoka-ramsey-community-college", platform: "acalog", baseUrl: "https://catalog.anokaramsey.edu", catoid: 3, navoid: 156 },
  { slug: "century-college", platform: "acalog", baseUrl: "https://catalog.century.edu", catoid: 23, navoid: 1601 },
  { slug: "dakota-county-technical-college", platform: "acalog", baseUrl: "https://catalog.dctc.edu", catoid: 2, navoid: 47 },
  { slug: "inver-hills-community-college", platform: "acalog", baseUrl: "https://catalog.inverhills.edu", catoid: 2, navoid: 44 },
  { slug: "saint-paul-college", platform: "acalog", baseUrl: "https://catalog.saintpaul.edu", catoid: 5, navoid: 201 },
  // SmartCatalogIQ
  { slug: "hennepin-technical-college", platform: "smartcatalogiq", catalogBase: "https://hennepintech.smartcatalogiq.com/en/2026-2027/catalog", coursesPath: "course-outlines" },
  { slug: "normandale-community-college", platform: "smartcatalogiq", catalogBase: "https://normandale.smartcatalogiq.com/en/2025-2026/course-catalog", coursesPath: "courses" },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(url: string, label: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  // Acalog catalogs sit behind AWS WAF Bot Control — needs full Chrome-like
  // header set + Referer matching the catalog origin or it returns an
  // empty JS-challenge page.
  for (let i = 0; i < attempts; i++) {
    try {
      const u = new URL(url);
      const referer = `${u.protocol}//${u.host}/`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Referer: referer,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (res.ok) return await res.text();
      if (res.status >= 500) lastErr = new Error(`HTTP ${res.status}`);
      else return "";
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

async function pmap<T, R>(items: T[], n: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch (e) {
        console.error(`  pmap[${i}] ${e}`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ----------------------------------------------------------------------
// Acalog
// ----------------------------------------------------------------------

function acalogListUrl(c: CollegeCatalog, cpage: number): string {
  return (
    `${c.baseUrl}/content.php?catoid=${c.catoid}` +
    `&navoid=${c.navoid}` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function acalogDetailUrl(c: CollegeCatalog, coid: string): string {
  return `${c.baseUrl}/preview_course_nopop.php?catoid=${c.catoid}&coid=${coid}`;
}

function extractAcalogCoids(html: string): string[] {
  const matches = html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function decodeText(raw: string): string {
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
    .replace(/\s+/g, " ")
    .trim();
}

function extractCourseCodes(text: string, excludeOwn?: string): string[] {
  const out = new Set<string>();
  const re = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const code = `${m[1]} ${m[2]}`;
    if (code !== excludeOwn) out.add(code);
  }
  return Array.from(out).sort();
}

function parseAcalogDetail(html: string): { prefix: string; number: string; text: string; courses: string[] } | null {
  const titleMatch = html.match(/<title>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*-/);
  if (!titleMatch) return null;
  const prefix = titleMatch[1].toUpperCase();
  const number = titleMatch[2];
  // Match optional leading "Course " (anokatech) and trailing punctuation.
  const m = html.match(
    /<strong>\s*(?:Course\s+)?Pre[-\s]?[Rr]equisite(?:s|\(s\))?\s*:?\s*<\/strong>\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
  );
  if (!m) return null;
  const text = decodeText(m[1]).replace(/[.;,]\s*$/, "").trim();
  if (!text || /^none\b/i.test(text) || /^not applicable/i.test(text)) return null;
  return { prefix, number, text, courses: extractCourseCodes(text, `${prefix} ${number}`) };
}

async function scrapeAcalog(c: CollegeCatalog, maxPages: number): Promise<Record<string, PrereqEntry>> {
  console.log(`  [${c.slug}] Acalog catoid=${c.catoid} navoid=${c.navoid}`);
  const allCoids = new Set<string>();
  let consecutiveEmpty = 0;
  for (let cpage = 1; cpage <= maxPages; cpage++) {
    let html = await retryFetch(acalogListUrl(c, cpage), `${c.slug} list(${cpage})`);
    let coids = extractAcalogCoids(html);
    // AWS WAF Bot Control returns a 1991-byte challenge page on the first
    // request after a cold start or rate-limit cooldown. If we get an
    // empty list page, warm up again and retry once.
    if (coids.length === 0 && cpage === 1) {
      console.log(`    page 1 empty — re-warming session and retrying`);
      await sleep(3000);
      await warmupSession(c.baseUrl!);
      await sleep(1000);
      html = await retryFetch(acalogListUrl(c, cpage), `${c.slug} list(${cpage}) retry`);
      coids = extractAcalogCoids(html);
    }
    if (coids.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
      continue;
    }
    consecutiveEmpty = 0;
    for (const coid of coids) allCoids.add(coid);
    await sleep(100);
  }
  const coidList = Array.from(allCoids);
  console.log(`    ${coidList.length} unique coids; fetching details...`);

  const out: Record<string, PrereqEntry> = {};
  let done = 0;
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(acalogDetailUrl(c, coid), `${c.slug} coid=${coid}`);
    const parsed = parseAcalogDetail(html);
    if (parsed) {
      const key = `${parsed.prefix} ${parsed.number}`;
      out[key] = { text: parsed.text, courses: parsed.courses, source: c.slug };
    }
    done++;
    if (done % 100 === 0) console.log(`    ${done}/${coidList.length}`);
  });
  console.log(`    ${c.slug}: ${Object.keys(out).length} prereqs`);
  return out;
}

// ----------------------------------------------------------------------
// SmartCatalogIQ
// ----------------------------------------------------------------------

function parseScIqDetail(html: string): { prefix: string; number: string; text: string; courses: string[] } | null {
  // <h1>\n\t<span>ACCT1102</span> Principles of Accounting I\n</h1>  (Hennepin)
  // <h1>\n\t<span>ACCT 1051</span> Accounting Basics\n</h1>           (Normandale, space)
  const codeMatch = html.match(/<h1[^>]*>\s*<span>\s*([A-Z]{2,5})[-\s]?(\d{3,4}[A-Z]?)\s*<\/span>/);
  if (!codeMatch) return null;
  const prefix = codeMatch[1].toUpperCase();
  const number = codeMatch[2];

  // Prereq block: <h2>\n\t\tPrerequisite\n\t</h2>... up to next <div class="sc_..." or <h2.
  const m = html.match(/<h2>\s*Prerequisite(?:\(s\))?\s*<\/h2>([\s\S]*?)(?:<div\s+class="sc_|<h2>|<\/section)/i);
  if (!m) return null;
  // The captured text may contain <a> tags wrapping course codes (with no space, e.g. ENGL0921).
  // Normalize "ENGL0921" → "ENGL 0921" so extractCourseCodes can parse them.
  let text = decodeText(m[1])
    .replace(/\b([A-Z]{2,5})(\d{3,4}[A-Z]?)\b/g, "$1 $2")
    .replace(/[.;,]\s*$/, "")
    .trim();
  if (!text || /^none\b/i.test(text)) return null;
  text = text.split(/\bCorequisite/i)[0].trim();
  if (!text) return null;
  return { prefix, number, text, courses: extractCourseCodes(text, `${prefix} ${number}`) };
}

async function discoverScIqCourseUrls(c: CollegeCatalog): Promise<string[]> {
  // SmartCatalogIQ structure: /${c.coursesPath || "course-outlines"}/ → department pages →
  // level pages (e.g. /1000) → individual course pages
  // (e.g. /acct1102). We walk all three levels.
  const origin = new URL(c.catalogBase!).origin;
  const indexUrl = `${c.catalogBase}/${c.coursesPath || "course-outlines"}/`;
  const indexHtml = await retryFetch(indexUrl, `${c.slug} index`);

  const coursesPath = c.coursesPath || "course-outlines";
  const linkRe = new RegExp(`href="([^"]*\\/${coursesPath}\\/[^"]+)"`, "gi");
  const extractLinks = (html: string): Set<string> => {
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html))) {
      let url = m[1];
      if (url.startsWith("/")) url = origin + url;
      out.add(url);
    }
    linkRe.lastIndex = 0;
    return out;
  };

  // Layer 1: departments
  const depUrls = Array.from(extractLinks(indexHtml)).filter(
    (u) => u !== indexUrl && u !== indexUrl.replace(/\/$/, ""),
  );
  // Layer 2: per-department, find level pages
  const levelUrls = new Set<string>();
  for (const dep of depUrls) {
    try {
      const dh = await retryFetch(dep, `${c.slug} dep`);
      for (const u of extractLinks(dh)) {
        if (u === dep) continue;
        // Course URLs end in a course-code segment like acct1102; level
        // URLs end in a numeric segment like /1000. Keep both for now —
        // we'll filter at layer 3.
        levelUrls.add(u);
      }
      await sleep(60);
    } catch (e) {
      console.error(`    dep fetch failed: ${dep}: ${e}`);
    }
  }
  // Layer 3: per-level, find course pages. A course URL ends in
  // `<prefix><number>` (e.g. acct1102) — distinguish from level pages
  // which end in just digits (e.g. /1000).
  const courseUrls = new Set<string>();
  // Course URL formats: /acct1051 (Hennepin) or /acct-1051 (Normandale)
  const isCourseUrl = (u: string) => /\/[a-z]{2,5}-?\d{3,4}[a-z]?$/i.test(u);
  for (const lvl of levelUrls) {
    if (isCourseUrl(lvl)) {
      courseUrls.add(lvl);
      continue;
    }
    try {
      const lh = await retryFetch(lvl, `${c.slug} lvl`);
      for (const u of extractLinks(lh)) {
        if (isCourseUrl(u)) courseUrls.add(u);
      }
      await sleep(60);
    } catch (e) {
      console.error(`    lvl fetch failed: ${lvl}: ${e}`);
    }
  }
  return Array.from(courseUrls);
}

async function scrapeSmartCatalogIq(c: CollegeCatalog): Promise<Record<string, PrereqEntry>> {
  console.log(`  [${c.slug}] SmartCatalogIQ ${c.catalogBase}`);
  const urls = await discoverScIqCourseUrls(c);
  console.log(`    ${urls.length} course URLs discovered`);
  const out: Record<string, PrereqEntry> = {};
  let done = 0;
  await pmap(urls, CONCURRENCY, async (url) => {
    const html = await retryFetch(url, `${c.slug} ${url}`);
    const parsed = parseScIqDetail(html);
    if (parsed) {
      const key = `${parsed.prefix} ${parsed.number}`;
      out[key] = { text: parsed.text, courses: parsed.courses, source: c.slug };
    }
    done++;
    if (done % 100 === 0) console.log(`    ${done}/${urls.length}`);
  });
  console.log(`    ${c.slug}: ${Object.keys(out).length} prereqs`);
  return out;
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

/**
 * Warm up the WAF session by hitting the catalog index page once. AWS
 * WAF Bot Control returns a 1991-byte challenge HTML on the first
 * content request unless the client has issued an index.php request
 * recently from the same origin.
 */
async function warmupSession(baseUrl: string): Promise<void> {
  try {
    await retryFetch(`${baseUrl}/index.php`, `${baseUrl} warmup`);
  } catch {
    /* non-fatal */
  }
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const limitPagesIdx = args.indexOf("--limit-pages");
  const maxPages = limitPagesIdx >= 0 ? parseInt(args[limitPagesIdx + 1], 10) : MAX_PAGES;
  const resume = args.includes("--resume");

  console.log("🌲 MN catalog prereq scraper");
  let targets = collegeFilter ? COLLEGES.filter((c) => c.slug === collegeFilter) : COLLEGES;
  if (collegeFilter && targets.length === 0) {
    console.error(`Unknown college: ${collegeFilter}`);
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), "data", "mn", "prereqs.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // --resume: load existing prereqs and skip any college already represented.
  const merged: Record<string, PrereqEntry> = {};
  if (resume && fs.existsSync(outPath)) {
    const existing: Record<string, PrereqEntry> = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    Object.assign(merged, existing);
    const doneSlugs = new Set(Object.values(existing).map((v) => v.source));
    const before = targets.length;
    targets = targets.filter((c) => !doneSlugs.has(c.slug));
    console.log(`  resume: loaded ${Object.keys(existing).length} mappings; ${before - targets.length} colleges already done`);
  }

  for (const c of targets) {
    try {
      // Warm up WAF session for Acalog instances before each college.
      if (c.platform === "acalog" && c.baseUrl) await warmupSession(c.baseUrl);
      const partial = c.platform === "acalog" ? await scrapeAcalog(c, maxPages) : await scrapeSmartCatalogIq(c);
      for (const [k, v] of Object.entries(partial)) {
        // First writer wins (MnSCU common course codes mean values should match)
        if (!merged[k]) merged[k] = v;
      }
      // Checkpoint after every college so a kill doesn't lose finished work.
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
      console.log(`  📁 checkpoint: ${Object.keys(merged).length} total mappings written`);
    } catch (e) {
      console.error(`  ${c.slug} failed: ${e}`);
      // Still checkpoint anything we did get before the failure.
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
    }
  }

  console.log(`\n✅ ${Object.keys(merged).length} prereq entries → ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error("❌ failed:", err);
  process.exit(1);
});
