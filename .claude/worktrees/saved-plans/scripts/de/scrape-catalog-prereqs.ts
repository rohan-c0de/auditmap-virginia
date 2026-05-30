/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes the Delaware Tech Community College course catalog at
 * https://dtcc.smartcatalogiq.com to extract prerequisite text for every
 * active course. This is a fallback source for the main Banner scraper,
 * which returns empty prereq data from DTCC's `getSectionPrerequisites`
 * endpoint (confirmed 0% coverage on all ~650 unique DE courses).
 *
 * Flow:
 *   1. GET /en/current/catalog/courses           → subject index (87 subjects)
 *   2. GET /en/current/catalog/courses/{subject} → course index per subject
 *   3. GET /en/current/catalog/courses/{subject}/{level}/{course}
 *                                                 → course page with prereq
 *   4. Parse prereq via cheerio (<h2>Prerequisite</h2> followed by <p>) and
 *      write data/de/prereqs.json keyed by "${PREFIX} ${NUMBER}".
 *
 * The catalog updates once per semester. Re-run only when DTCC publishes a
 * new catalog year (`/en/2025-2026/catalog/...`). The output JSON is
 * checked into git so the course scraper does not depend on network access
 * to DTCC's catalog site.
 *
 * Usage:
 *   npx tsx scripts/de/scrape-catalog-prereqs.ts
 *   npx tsx scripts/de/scrape-catalog-prereqs.ts --subject acc-accounting
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const BASE = "https://dtcc.smartcatalogiq.com";
const INDEX_PATH = "/en/current/catalog/courses";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// SmartCatalog sits behind a CDN and handles modest parallel load. 8 workers
// with a 50ms per-worker delay keeps us around ~10 req/s — comfortably
// beneath any observed rate-limit signal.
const CONCURRENCY = 8;
const DELAY_MS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqEntry {
  text: string;
  courses: string[];
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
        // 4xx — don't retry, but don't throw (some courses may be discontinued
        // and return 404; the caller decides how to handle that).
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Concurrency primitive: bounded parallel map
// (Same shape as scripts/ny/scrape-transfer-trex.ts pmap.)
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
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract subject-page links from the top-level `/en/current/catalog/courses`
 * index. Each link matches `/en/current/catalog/courses/{slug}` where slug
 * looks like `acc-accounting`, `bio-biology`, etc. Returns an array of slugs
 * (without the leading path) for downstream URL construction.
 */
function parseSubjectIndex(html: string): string[] {
  const $ = cheerio.load(html);
  const slugs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/en\/current\/catalog\/courses\/([a-z][a-z0-9-]+)\/?$/i);
    if (m) slugs.add(m[1]);
  });
  return Array.from(slugs).sort();
}

/**
 * Extract course-page links from a subject index page. Pattern matches
 * `/en/current/catalog/courses/{subject}/{level}/{prefix-number}`, e.g.
 * `/en/current/catalog/courses/acc-accounting/100/acc-101`. Returns full
 * URL paths (starting with `/en/...`) for downstream fetching.
 */
function parseSubjectPage(html: string, subjectSlug: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const subjectPrefix = `/en/current/catalog/courses/${subjectSlug}/`;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.startsWith(subjectPrefix)) return;
    // Require at least one more path segment after the subject slug
    // (the "level" folder) plus a final segment (the course slug).
    const rest = href.substring(subjectPrefix.length).replace(/\/$/, "");
    if (rest.split("/").length < 2) return;
    urls.add(href);
  });
  return Array.from(urls).sort();
}

/**
 * Parse a single course page. Returns { prefix, number, text, courses } or
 * null if the course has no prerequisite listed.
 *
 * HTML structure (verified against ACC 101):
 *   <h1>ACC 101 Accounting I</h1>
 *   ...
 *   <h2>Prerequisite</h2>
 *   <p>Prerequisite: (<a href="...mat-152">MAT 152</a> or concurrent) or
 *      (<a href="...mat-162">MAT 162</a> or concurrent)</p>
 *
 * Some courses use <h2>Prerequisites</h2> (plural). Some wrap the prereq in
 * a div.sc_prepreqs or similar SmartCatalog-specific class. We try the
 * generic h2 heading first and fall back to a text search for "Prerequisite:"
 * anywhere in the body.
 */
function parseCoursePage(
  html: string,
): { prefix: string; number: string; text: string; courses: string[] } | null {
  const $ = cheerio.load(html);

  // --- Course title / code ---
  // <h1>ACC 101 Accounting I</h1>  (some pages prepend a tracking span)
  const h1 = $("h1").first().text().trim();
  const titleMatch = h1.match(/^([A-Z]{2,5})\s*[-\s]?\s*(\d{2,4}[A-Z]?)\b/);
  if (!titleMatch) return null;
  const prefix = titleMatch[1].toUpperCase();
  const number = titleMatch[2];

  // --- Find the prereq paragraph ---
  // SmartCatalog renders the prereq in a <p> immediately following an
  // <h2>Prerequisite</h2> (or "Prerequisites" or "Prerequisite(s)"). We walk
  // all h2 headings looking for one whose text starts with "prerequisite".
  let prereqHtml = "";
  $("h2, h3").each((_, el) => {
    const heading = $(el).text().trim().toLowerCase();
    if (!heading.startsWith("prerequisite")) return;
    // Grab the next sibling element's HTML. SmartCatalog usually puts the
    // body text in a <p> immediately after the heading.
    const sibling = $(el).next();
    const sibText = sibling.text().trim();
    if (sibText && !sibText.toLowerCase().startsWith("corequisite")) {
      prereqHtml = sibling.html() || "";
    }
  });

  // Fallback: some pages inline the prereq in the description paragraph as
  // "Prerequisite: XXX" without a dedicated h2. Search all <p> for the label.
  if (!prereqHtml) {
    $("p").each((_, el) => {
      const text = $(el).text().trim();
      const m = text.match(/^Prerequisite(?:s|\(s\))?:\s*(.+)$/i);
      if (m) {
        prereqHtml = $(el).html() || "";
      }
    });
  }

  if (!prereqHtml) return null;

  // --- Normalize the prereq text ---
  // Strip HTML tags but preserve link text (SmartCatalog wraps course codes
  // in <a> tags; we want the anchor text). cheerio's .text() on a fragment
  // handles this, but we loaded a fragment here so reparse.
  const $frag = cheerio.load(`<div>${prereqHtml}</div>`);
  let text = $frag("div").first().text().trim();
  // Strip leading "Prerequisite:" / "Prerequisites:" labels if present.
  text = text.replace(/^Prerequisite(?:s|\(s\))?:\s*/i, "").trim();
  // Collapse internal whitespace
  text = text.replace(/\s+/g, " ");

  if (!text) return null;

  // Filter out non-prerequisite placeholders. SmartCatalog fills the
  // Prerequisite field even when there is no real prereq, using stock
  // phrases like "None" (34x), "Students may complete technical electives…"
  // (121x on DTCC), and a few one-offs. These are not useful in the UI.
  if (/^none\b/i.test(text)) return null;
  if (/^students may complete.*elective/i.test(text)) return null;

  // --- Extract parsed course codes ---
  // Priority 1: anchor hrefs in the SmartCatalog pattern
  // `/en/.../courses/{subject}/{level}/{prefix}-{number}`
  const courses = new Set<string>();
  $frag("a[href]").each((_, a) => {
    const href = $frag(a).attr("href") || "";
    const m = href.match(/\/courses\/[^/]+\/[^/]+\/([a-z]{2,5})-(\d{2,4}[a-z]?)(?:\/|$)/i);
    if (m) {
      courses.add(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
    }
  });

  // Priority 2: regex fallback against the text (catches non-linked codes)
  const codeRegex = /\b([A-Z]{2,5})\s*(\d{2,4}[A-Z]?)\b/g;
  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(text)) !== null) {
    const code = `${match[1]} ${match[2]}`;
    // Avoid capturing the course's own code ("ACC 101 is a prereq for ACC 101")
    if (code === `${prefix} ${number}`) continue;
    courses.add(code);
  }

  return { prefix, number, text, courses: Array.from(courses).sort() };
}

// ---------------------------------------------------------------------------
// Main scrape
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const subjectArg = args.find((a) => a.startsWith("--subject="))?.split("=")[1] || null;

  console.log("DTCC catalog prereq scraper");
  console.log(`  Base: ${BASE}${INDEX_PATH}`);

  // --- Phase 1: subject index ---
  console.log("\n[1/3] Fetching subject index...");
  const indexHtml = await retryFetch(`${BASE}${INDEX_PATH}`, "subject-index");
  let subjects = parseSubjectIndex(indexHtml);
  console.log(`  Found ${subjects.length} subjects`);
  if (subjectArg) {
    subjects = subjects.filter((s) => s === subjectArg);
    console.log(`  Filtered to: ${subjects.join(", ")}`);
  }

  // --- Phase 2: course URLs per subject ---
  console.log("\n[2/3] Fetching subject pages...");
  const allCourseUrls: string[] = [];
  await pmap(subjects, CONCURRENCY, async (subject) => {
    const url = `${BASE}/en/current/catalog/courses/${subject}`;
    const html = await retryFetch(url, `subject(${subject})`);
    const courseUrls = parseSubjectPage(html, subject);
    allCourseUrls.push(...courseUrls);
  });
  console.log(`  Found ${allCourseUrls.length} course URLs across ${subjects.length} subjects`);

  // Dedupe (some courses appear under multiple subject listings)
  const uniqueCourseUrls = Array.from(new Set(allCourseUrls));
  console.log(`  After dedup: ${uniqueCourseUrls.length} unique course URLs`);

  // --- Phase 3: course pages ---
  console.log("\n[3/3] Fetching course pages...");
  const prereqs: Record<string, PrereqEntry> = {};
  let seen = 0;
  let withPrereqs = 0;
  await pmap(uniqueCourseUrls, CONCURRENCY, async (coursePath) => {
    const url = coursePath.startsWith("http") ? coursePath : `${BASE}${coursePath}`;
    const html = await retryFetch(url, `course(${coursePath})`);
    if (!html) return; // 404 or empty body
    const parsed = parseCoursePage(html);
    seen++;
    if (seen % 50 === 0) {
      console.log(`  ${seen}/${uniqueCourseUrls.length} courses (${withPrereqs} with prereqs)`);
    }
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    // If the same code appears in two subject pages, the first wins (usually
    // identical content). Skip silently on duplicate key.
    if (prereqs[key]) return;
    prereqs[key] = { text: parsed.text, courses: parsed.courses };
    withPrereqs++;
  });
  console.log(`  Parsed ${seen}/${uniqueCourseUrls.length} course pages`);
  console.log(`  Extracted prereqs for ${Object.keys(prereqs).length} courses`);

  // --- Write output ---
  const outDir = path.join(process.cwd(), "data", "de");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(prereqs, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(prereqs).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
