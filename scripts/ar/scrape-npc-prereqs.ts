/**
 * scrape-npc-prereqs.ts — National Park College (AR) Acalog prereq scraper
 *
 * NPC's catalog at catalog.np.edu is behind an AWS WAF JS challenge that
 * returns 202 + empty body on bare fetch. We use Playwright to pass the
 * challenge once, extract session cookies, then make all subsequent
 * requests via plain HTTP with those cookies (fast, low overhead).
 *
 * Catalog structure:
 *   catoid=27, navoid=9836 ("Course Descriptions")
 *   449 courses across 5 pages
 *   ~60% have prereq text in the detail page
 *
 * Output: merges into data/ar/prereqs.json (additive — preserves existing
 *   entries from other AR colleges).
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-npc-prereqs.ts
 *   npx tsx scripts/ar/scrape-npc-prereqs.ts --limit=20
 */

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

const BASE = "https://catalog.np.edu";
const CATOID = 27;
const NAVOID = 9836; // "Course Descriptions"
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 80;
const MAX_PAGES = 10;

interface PrereqEntry {
  text: string;
  courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// WAF bypass — Playwright
// ---------------------------------------------------------------------------

async function acquireWafCookies(): Promise<string> {
  console.log("  Acquiring WAF cookies via Playwright...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE}/index.php?catoid=${CATOID}`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  const cookies = await page.context().cookies();
  await browser.close();
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  console.log(`  Got ${cookies.length} cookies`);
  return cookieStr;
}

// ---------------------------------------------------------------------------
// HTTP helpers (with WAF cookies)
// ---------------------------------------------------------------------------

async function retryFetch(
  url: string,
  label: string,
  cookies: string,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Cookie: cookies },
      });
      if (resp.status === 202) {
        // WAF challenge — cookies expired
        throw new Error("WAF 202 — cookies expired");
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
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
// Catalog endpoints
// ---------------------------------------------------------------------------

function listUrl(cpage: number): string {
  return (
    `${BASE}/content.php?catoid=${CATOID}` +
    `&catoid=${CATOID}` +
    `&navoid=${NAVOID}` +
    `&filter%5Bitem_type%5D=3` +
    `&filter%5Bonly_active%5D=1` +
    `&filter%5B3%5D=1` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function detailUrl(coid: string): string {
  return `${BASE}/preview_course_nopop.php?catoid=${CATOID}&coid=${coid}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function extractCoids(html: string): string[] {
  const matches =
    html.match(
      /preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g,
    ) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function extractCourseCode(
  html: string,
): { prefix: string; number: string } | null {
  const m = html.match(/<h1[^>]*>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*-/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2] };
}

function extractPrereqBlock(html: string): string | null {
  const m = html.match(
    /(?:<strong>\s*)?[Pp]re-?[Rr]equisite[s(]?\s*[):]?\s*:?\s*(?:<\/strong>)?\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>|<a\s+href=["']https:)/i,
  );
  return m ? m[1] : null;
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&#(\d+);?/g, (_, code) =>
      String.fromCharCode(parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAnchorCoids(block: string): string[] {
  const re = /coid=(\d+)/g;
  const coids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) coids.push(m[1]);
  return coids;
}

const BOILERPLATE_RE = /^(none|n\/a|not applicable)\s*\.?\s*$/i;

interface CourseDetail {
  coid: string;
  prefix: string;
  number: string;
  html: string;
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

  console.log("National Park College prereq scraper");
  console.log(`  Base: ${BASE}`);
  console.log(`  catoid=${CATOID} navoid=${NAVOID}`);

  // --- WAF bypass ---
  const cookies = await acquireWafCookies();

  // --- Phase 1: paginate list, collect coids ---
  console.log("\n[1/3] Paginating course list...");
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const html = await retryFetch(listUrl(cpage), `list(cpage=${cpage})`, cookies);
    const coids = extractCoids(html);
    console.log(`  cpage=${cpage}: ${coids.length} coids`);
    if (coids.length === 0) break;
    for (const c of coids) allCoids.add(c);
    await sleep(100);
  }
  let coidList = Array.from(allCoids);
  console.log(`  Total unique coids: ${coidList.length}`);

  if (limit > 0) {
    coidList = coidList.slice(0, limit);
    console.log(`  Limited to first ${limit} for smoke test`);
  }

  // --- Phase 2: fetch every detail page, build coid → code index ---
  console.log("\n[2/3] Fetching detail pages + building coid index...");
  const details: CourseDetail[] = [];
  const codeByCoid = new Map<string, string>();
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(detailUrl(coid), `detail(${coid})`, cookies);
    if (!html) return;
    const code = extractCourseCode(html);
    if (!code) return;
    details.push({ coid, prefix: code.prefix, number: code.number, html });
    codeByCoid.set(coid, `${code.prefix} ${code.number}`);
  });
  console.log(
    `  Fetched ${details.length} real course pages (${coidList.length - details.length} non-course descriptors skipped)`,
  );

  // --- Phase 3: parse prereq blocks, resolve anchor coids to codes ---
  console.log("\n[3/3] Parsing prereqs + resolving anchor refs...");
  const prereqs: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;
  let resolvedAnchors = 0;
  for (const d of details) {
    const block = extractPrereqBlock(d.html);
    if (!block) continue;

    const text = htmlToText(block);
    if (!text) continue;
    if (BOILERPLATE_RE.test(text)) continue;

    const courses = new Set<string>();
    const codeRegex = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;
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
    prereqs[key] = { text, courses: Array.from(courses).sort() };
    withPrereqs++;
  }
  console.log(`  Extracted prereqs for ${withPrereqs} courses`);
  console.log(
    `  Resolved ${resolvedAnchors} <a href> anchor references via coid index`,
  );

  // --- Merge into existing AR prereqs.json ---
  const outPath = path.join(process.cwd(), "data", "ar", "prereqs.json");
  let existing: Record<string, PrereqEntry> = {};
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {}

  let newCount = 0;
  let updatedCount = 0;
  for (const [key, entry] of Object.entries(prereqs)) {
    if (!existing[key]) {
      existing[key] = entry;
      newCount++;
    } else if (
      entry.courses.length > (existing[key].courses?.length ?? 0)
    ) {
      existing[key] = entry;
      updatedCount++;
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(existing).sort()) {
    sorted[key] = existing[key];
  }

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(
    `\n✓ Merged into ${outPath}: ${newCount} new + ${updatedCount} upgraded (${Object.keys(sorted).length} total)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
