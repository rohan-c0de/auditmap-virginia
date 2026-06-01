/**
 * scrape-catalog-prereqs-middlesex.ts
 *
 * Scrapes Middlesex Community College's Modern Campus / Acalog catalog at
 * https://catalog.middlesex.mass.edu to extract prereq text for every
 * active course. Middlesex uses Banner 8 for course listings; the
 * primary scraper (scripts/ma/scrape-banner8.ts) can't read prereqs out
 * of Banner 8's schedule HTML, so this catalog scrape fills the gap.
 *
 * Same two-pass Acalog engine as scripts/vt/ and scripts/ct/:
 *
 *   Pass 1: paginate the course list, collect coids, fetch every detail
 *           page once, and build a `coid → "PREFIX NUMBER"` index.
 *   Pass 2: re-scan each detail page's prereq block; resolve any anchor
 *           `coid=X` references to canonical course codes via the index.
 *
 * Output: data/ma/prereqs-middlesex.json keyed by "${PREFIX} ${NUMBER}".
 * A combiner script merges this with GCC's prereqs into data/ma/prereqs.json.
 *
 * The catalog year rolls over every summer. Re-run once Middlesex
 * The catalog ID is auto-discovered at runtime from the catalog dropdown.
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-catalog-prereqs-middlesex.ts
 *   npx tsx scripts/ma/scrape-catalog-prereqs-middlesex.ts --limit=50   # smoke test
 */

import * as fs from "fs";
import * as path from "path";
import { discoverAcalogCatoid } from "../lib/discover-catalog.js";

const BASE = "https://catalog.middlesex.mass.edu";
let CATOID = 35;       // fallback — auto-discovered at runtime
const NAVOID = 3331;   // "Course Descriptions" nav entry
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 8;
const DELAY_MS = 50;
const MAX_PAGES = 30;

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
        return ""; // 404 — course probably delisted; skip silently
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
  const matches = html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

/**
 * Extract the course code (prefix + number) from the detail page's H1.
 * Returns null for non-course pages (general-education descriptors, etc.)
 * which appear at the start of acalog's list and don't have a PREFIX NUMBER
 * header.
 */
function extractCourseCode(html: string): { prefix: string; number: string } | null {
  const m = html.match(/<h1[^>]*>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*-/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2] };
}

/**
 * Extract the raw prereq HTML block (before tag stripping) so we can
 * pull out `<a href="...coid=X">` links for resolution via the coid index.
 */
function extractPrereqBlock(html: string): string | null {
  // Match "Prerequisites:" (with optional <strong> wrapper) up to the next
  // <br><br>, </p>, or stock "Click here for course offerings" link.
  const m = html.match(
    /(?:<strong>\s*)?Prerequisites?(?:\(s\))?\s*:\s*(?:<\/strong>)?\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>|<a\s+href=["']https:)/i,
  );
  return m ? m[1] : null;
}

/** Strip HTML tags + decode common entities to plain text. */
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
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

/** Extract coid references from a block of HTML. Used to resolve prereq anchors. */
function extractAnchorCoids(htmlBlock: string): string[] {
  const matches = htmlBlock.match(/coid=(\d+)/g) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

// Stock phrases that indicate "no actual prereq" — filtered out to keep the
// output clean. CCV's boilerplate comes in a few variants.
const BOILERPLATE_RE =
  /^(students must meet basic skills policy requirements\.?\s*no other (course\s+)?prerequisites? required|none|not applicable|n\/a)\s*\.?\s*$/i;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

  console.log("Middlesex CC catalog prereq scraper");
  console.log(`  Base: ${BASE}`);
  CATOID = await discoverAcalogCatoid(BASE, CATOID);
  console.log(`  catoid=${CATOID} navoid=${NAVOID}`);

  // --- Phase 1: paginate list, collect coids ---
  console.log("\n[1/3] Paginating course list...");
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const html = await retryFetch(listUrl(cpage), `list(cpage=${cpage})`);
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
    const html = await retryFetch(detailUrl(coid), `detail(${coid})`);
    if (!html) return;
    const code = extractCourseCode(html);
    if (!code) return; // non-course page (gen-ed descriptor, etc.)
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

    // Extract course codes from the text itself (handles "MTH 1010", "ENG 2120")
    const courses = new Set<string>();
    const codeRegex = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;
    let m: RegExpExecArray | null;
    while ((m = codeRegex.exec(text)) !== null) {
      const code = `${m[1]} ${m[2]}`;
      if (code !== `${d.prefix} ${d.number}`) courses.add(code);
    }

    // Also resolve `<a href="...coid=X">` links in the raw block — CCV uses
    // anchor text like "Human Anatomy & Physiology II" which doesn't contain
    // the course code, so the text-only regex misses those.
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
  console.log(`  Resolved ${resolvedAnchors} <a href> anchor references via coid index`);

  // --- Merge into data/ma/prereqs.json ---
  //
  // MA has two Banner 8 colleges whose prereqs need a catalog scrape (GCC +
  // Middlesex), and ~29 course codes collide between them (e.g. both offer
  // "ART 123" but with different prereqs). We merge into a single file
  // tagged with `source` so downstream consumers can disambiguate. Within
  // Middlesex's scraper, Middlesex's own scrape always wins over any existing
  // Middlesex-sourced entry; it never overwrites other sources.
  const SOURCE = "middlesex";
  const outDir = path.join(process.cwd(), "data", "ma");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");

  type MergedEntry = PrereqEntry & { source: string };
  let existing: Record<string, MergedEntry> = {};
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* no existing file — fresh start */
  }

  // Drop any previous Middlesex entries so a rerun doesn't leave stale rows.
  for (const k of Object.keys(existing)) {
    if (existing[k].source === SOURCE) delete existing[k];
  }
  let preserved = 0;
  for (const [key, entry] of Object.entries(prereqs)) {
    if (existing[key]) {
      // Collision with another source (e.g. gcc). Keep the other source's
      // entry under its bare key, and stash ours under "middlesex:KEY".
      existing[`${SOURCE}:${key}`] = { ...entry, source: SOURCE };
    } else {
      existing[key] = { ...entry, source: SOURCE };
      preserved++;
    }
  }

  const sorted: Record<string, MergedEntry> = {};
  for (const key of Object.keys(existing).sort()) sorted[key] = existing[key];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Merged ${withPrereqs} Middlesex prereqs into ${outPath}`);
  console.log(`  (${preserved} fresh keys + ${withPrereqs - preserved} collision-suffixed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
