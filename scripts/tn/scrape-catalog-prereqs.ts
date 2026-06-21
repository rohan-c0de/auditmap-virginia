/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes Pellissippi State Community College's acalog/CourseLeaf catalog
 * at https://catalog.pstcc.edu to extract prerequisite text for every
 * active TBR common course. Pellissippi is used as the authoritative
 * source for all 12 TBR community colleges because:
 *
 *   1. TBR enforces common course numbering across the 13 system colleges,
 *      so ENGL 1010, MATH 1530, HIST 2010 etc. share identical catalog
 *      descriptions and prereqs system-wide.
 *   2. Pellissippi publishes the full ~718-course catalog on a public
 *      acalog site with no login or geo-gating.
 *   3. The Banner `getSectionPrerequisites` endpoint returns empty HTML
 *      on every TBR Banner instance (~3% coverage vs. 50%+ on GA/MD),
 *      so a catalog fallback is the only path to useful prereq data.
 *
 * Flow:
 *   1. Iterate cpage=1..N against
 *      /content.php?catoid=20&navoid=1165&filter[item_type]=3&filter[cpage]=N
 *      and extract `preview_course_nopop.php?coid=XXXXX` links until a
 *      page returns zero courses.
 *   2. For each coid, GET the detail page and parse the inline
 *      `<strong>Prerequisite(s):</strong> …<br>` block.
 *   3. Write data/tn/prereqs.json keyed by "${PREFIX} ${NUMBER}".
 *
 * The TBR catalog year rolls over every summer. Re-run once per summer
 * when Pellissippi publishes the new catoid. Update CATOID below when that
 * happens.
 *
 * Usage:
 *   npx tsx scripts/tn/scrape-catalog-prereqs.ts
 *   npx tsx scripts/tn/scrape-catalog-prereqs.ts --limit=20   # smoke test
 */

import * as fs from "fs";
import * as path from "path";
import { createAcalogFetch } from "../lib/acalog-waf-fetch";

const BASE = "https://catalog.pstcc.edu";
const CATOID = 20;       // Pellissippi 2026-2027 catalog id
const NAVOID = 1165;     // "Course Descriptions" nav entry

// We MERGE into the existing data/tn/prereqs.json rather than overwrite it.
// That file's base is course-section-aggregated (≈628 entries, every one backed
// by a live section's prerequisite_text — see scripts/tn/aggregate-prereqs.ts
// which runs first in the prereqs job). This catalog adds ≈79 prereqs the
// sections don't carry (e.g. AGRI). Each entry we own is tagged
// `source: SOURCE` so a later `aggregate-prereqs --force` rebuild preserves it
// via preserveSourcedEntries() instead of silently dropping it. Overwriting
// here is exactly the regression that closed PR #1465 (628 → 503).
const SOURCE = "pstcc";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 8 workers × 50ms delay keeps us around ~10 req/s. acalog sits behind a
// CloudFront CDN and absorbs this rate comfortably.
const CONCURRENCY = 8;
const DELAY_MS = 50;

// Hard cap on pagination to avoid runaway loops. Pellissippi currently has
// 8 pages; this gives us headroom for future catalog growth.
const MAX_PAGES = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqEntry {
  text: string;
  courses: string[];
  /** Set on entries this scraper contributes, so a section-derived rebuild
   *  (aggregate-prereqs --force) preserves them rather than dropping them. */
  source?: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// pstcc.edu moved behind AWS WAF (202 + empty body on plain fetch); the shared
// WAF-aware fetcher solves the JS challenge via headless Chromium and carries
// the aws-waf-token cookie. It throws (rather than silently returning "") when
// a challenge can't be cleared, so a blocked run aborts instead of writing a
// partial catalog. See scripts/lib/acalog-waf-fetch.ts.
const retryFetch = createAcalogFetch({ ua: UA });

// ---------------------------------------------------------------------------
// Concurrency primitive
// ---------------------------------------------------------------------------

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
// Catalog endpoints
// ---------------------------------------------------------------------------

function listUrl(cpage: number): string {
  // acalog uses bracketed filter params that must be URL-encoded. The
  // `filter[3]=1` param selects a specific course-type checkbox on the
  // filter form; removing it would also work but keeps the URL consistent
  // with what a browser would emit.
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

/**
 * Extract coid values from a paginated list page. The list page HTML
 * contains `<a href="preview_course_nopop.php?catoid=20&coid=21431">` links
 * for every course on that page (100 per page by default). We regex rather
 * than cheerio-parse because the extraction is trivial and regex is ~3x
 * faster over a ~100 KB HTML blob.
 */
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
 * Parse a course detail page. Returns { prefix, number, text, courses } or
 * null if no prereq is published.
 *
 * HTML structure (verified against ACCT 1010):
 *   <title>ACCT 1010 - Principles of Accounting I - </title>
 *   ...
 *   <p>... description text <br><br>
 *      <strong>Prerequisite(s):</strong> ACT Reading score of 19 or …<br><br>
 *   </p>
 *
 * Some courses use `<strong>Corequisite(s):</strong>` with no prereq, and
 * some omit both fields. Some have both in the same paragraph — we extract
 * only the Prerequisite block and stop at the next `<strong>` or `<br><br>`.
 */
function parseDetailPage(
  html: string,
): { prefix: string; number: string; text: string; courses: string[] } | null {
  // --- Title / course code ---
  const titleMatch = html.match(
    /<title>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*-/,
  );
  if (!titleMatch) return null;
  const prefix = titleMatch[1].toUpperCase();
  const number = titleMatch[2];

  // --- Prereq text ---
  // Find "<strong>Prerequisite(s):</strong>" (also handle "Prerequisite:"
  // without the parenthetical plural) and capture text until the next
  // <br><br>, </p>, or <strong> boundary.
  const prereqMatch = html.match(
    /<strong>\s*Prerequisite(?:s|\(s\))?\s*:?\s*<\/strong>\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
  );
  if (!prereqMatch) return null;

  // Strip HTML tags inside the captured text (some entries link to other
  // courses via <a>; we want the anchor text).
  //
  // acalog emits `&#160;` (numeric non-breaking space) between course codes
  // and the trailing `<br>`. We normalize both `&nbsp;` and `&#160;` (with
  // or without the trailing semicolon — acalog is inconsistent) to regular
  // spaces so downstream code-regex matching isn't confused.
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

  // Strip trailing punctuation / noise
  text = text.replace(/[.;,]\s*$/, "").trim();

  if (!text) return null;

  // Filter stock phrases that are not real prereqs (same rationale as
  // scripts/de/scrape-catalog-prereqs.ts).
  if (/^none\b/i.test(text)) return null;
  if (/^not applicable/i.test(text)) return null;

  // --- Extract parsed course codes ---
  // Pattern matches TBR common course codes: 4-letter prefix + 4-digit
  // number, optionally with a letter suffix (e.g. "ENGL 1010", "MATH 1530",
  // "BIOL 2010L"). Exclude the course's own code.
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

  console.log("TBR catalog prereq scraper (source: Pellissippi State)");
  console.log(`  Base: ${BASE}`);
  console.log(`  catoid=${CATOID} navoid=${NAVOID}`);

  // --- Phase 1: paginate the course list ---
  console.log("\n[1/2] Paginating course list...");
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

  // --- Phase 2: detail pages ---
  console.log("\n[2/2] Fetching detail pages...");
  const prereqs: Record<string, PrereqEntry> = {};
  let seen = 0;
  let withPrereqs = 0;
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(detailUrl(coid), `detail(${coid})`);
    seen++;
    if (seen % 100 === 0) {
      console.log(`  ${seen}/${coidList.length} courses (${withPrereqs} with prereqs)`);
    }
    if (!html) return;
    const parsed = parseDetailPage(html);
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (prereqs[key]) return; // first wins
    prereqs[key] = { text: parsed.text, courses: parsed.courses };
    withPrereqs++;
  });
  console.log(`  Parsed ${seen}/${coidList.length} detail pages`);
  console.log(`  Extracted prereqs for ${Object.keys(prereqs).length} courses`);

  // --- Merge into existing prereqs.json (never overwrite) ---
  const outDir = path.join(process.cwd(), "data", "tn");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");

  let merged: Record<string, PrereqEntry> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) merged = raw;
  } catch {
    /* no existing file — fresh start */
  }
  const baseCount = Object.keys(merged).length;

  // Drop our own previous contributions so a re-run refreshes cleanly, leaving
  // the course-aggregated base (entries without our source) untouched.
  for (const k of Object.keys(merged)) {
    if (merged[k]?.source === SOURCE) delete merged[k];
  }

  // Add only the catalog prereqs the base doesn't already carry. The base is
  // derived from real section prerequisite_text, so on a key collision the base
  // wins and we skip the catalog duplicate.
  let added = 0;
  for (const [key, entry] of Object.entries(prereqs)) {
    if (merged[key]) continue;
    merged[key] = { ...entry, source: SOURCE };
    added++;
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(
    `\n✓ Catalog yielded ${Object.keys(prereqs).length} prereqs; merged +${added} ` +
      `net-new onto a base of ${baseCount} → ${Object.keys(sorted).length} total in ${outPath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
