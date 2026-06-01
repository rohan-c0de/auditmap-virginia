/**
 * scrape-prereqs.ts — Colorado statewide course-prerequisite scraper.
 *
 * Colorado community colleges share a statewide Common Course Numbering System
 * (CCNS): a course code like "BIO 2101" means the same course at every CCCS
 * college, so a prereq scraped from one college's catalog applies system-wide.
 * We therefore aggregate into ONE data/co/prereqs.json keyed by course code.
 *
 * Two public catalogs, both server-rendered (no JS needed):
 *
 *   SOURCE 1 — Red Rocks CC (SmartCatalogIQ)
 *     Index:   https://rrcc.smartcatalogiq.com/en/2025-2026/catalog/course-descriptions
 *     Subject: .../course-descriptions/{subject-slug}        (lists course-detail links inline)
 *     Course:  .../course-descriptions/{subject}/{level}/{course-id}
 *     Prereq:  <div class="sc_prereqs"><h2>Prerequisite</h2>{TEXT}</div>
 *
 *   SOURCE 2 — Community College of Denver (CourseLeaf)
 *     Index:   https://catalog.ccd.edu/programs-courses/courses/
 *     Subject: https://catalog.ccd.edu/programs-courses/courses/{prefix}/   (all courses inline)
 *     Course:  <div class="courseblock"> with
 *                <p class="courseblocktitle"><strong>BIO 2101 | ...</strong>
 *                <p class="courseblockreqs"><strong>Prerequisite:</strong> ...</p>
 *
 * Output object shape (matches data/va/prereqs.json):
 *   { "BIO 2101": { "text": "BIO 1111 or BIO 1010 ...", "courses": ["BIO 1111","BIO 1010"] } }
 *
 * text   — cleaned prereq sentence, NO HTML tags.
 * courses — CCNS course codes referenced in text (regex-extracted, deduped).
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface PrereqEntry {
  text: string;
  courses: string[];
}

async function retryFetch(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA } });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      if (i === attempts - 1) {
        console.error(`  fetch ${url} failed: ${(e as Error).message}`);
        return null;
      }
      await sleep(500 * Math.pow(2, i));
    }
  }
  return null;
}

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>,
  delayMs = 60,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Shared text cleaning / code extraction
// ---------------------------------------------------------------------------

/** Strip ALL HTML, decode common entities, normalize whitespace incl. nbsp. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;| /gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract CCNS course codes (PREFIX + number) referenced in cleaned text. */
function extractRefdCourses(text: string, selfCode: string): string[] {
  const codes = new Set<string>();
  // CCNS codes: 2-4 uppercase letters + 3-4 digit number, e.g. BIO 1111, MAT 1340
  const re = /\b([A-Z]{2,4})\s?-?\s?(\d{3,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = `${m[1]} ${m[2]}`;
    if (c !== selfCode) codes.add(c);
  }
  return Array.from(codes).sort();
}

/** Parse "bio-2101" / "ACC1011" / "BIO 2101" → "BIO 2101". */
function normalizeCode(raw: string): string | null {
  const m = raw
    .toUpperCase()
    .replace(/ /g, " ")
    .match(/^([A-Z]{2,4})[\s-]?(\d{3,4})$/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

// ---------------------------------------------------------------------------
// SOURCE 1 — Red Rocks CC (SmartCatalogIQ)
// ---------------------------------------------------------------------------

const RRCC_BASE = "https://rrcc.smartcatalogiq.com";
const RRCC_INDEX = `${RRCC_BASE}/en/2025-2026/catalog/course-descriptions`;

/** Subject-page URLs from the index (depth-5 slugs like ".../acc-accounting-courses"). */
function rrccSubjectUrls(html: string): string[] {
  const re =
    /href="(\/en\/2025-2026\/catalog\/course-descriptions\/[a-z0-9][^"]*)"/gi;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const segs = m[1].split("/").filter(Boolean);
    // ["en","2025-2026","catalog","course-descriptions","{subject-slug}"]
    if (segs.length === 5) urls.add(RRCC_BASE + m[1]);
  }
  return Array.from(urls);
}

/** Course-detail URLs listed inline on a subject page (depth 7). */
function rrccCourseUrls(html: string): { url: string; code: string }[] {
  // .../course-descriptions/{subject}/{level}/{prefix-number}
  const re =
    /href="(\/en\/2025-2026\/catalog\/course-descriptions\/[^"\/]+\/\d{3,4}\/([a-z]{2,4}-\d{3,4}[a-z]?))"/gi;
  const out: { url: string; code: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const code = normalizeCode(m[2]);
    if (code) out.push({ url: RRCC_BASE + m[1], code });
  }
  return out;
}

/** Extract clean prereq text from an RRCC course detail page. */
function rrccPrereq(html: string): string | null {
  const m = html.match(/<div\s+class="sc_prereqs"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  // Drop the "Prerequisite" heading, then strip remaining HTML.
  const inner = m[1].replace(
    /<h[1-6][^>]*>[\s\S]*?Pre-?requisite[s]?[\s\S]*?<\/h[1-6]>/gi,
    "",
  );
  const text = cleanText(inner);
  if (!text) return null;
  if (/^(none|n\/a|not applicable|no prerequisite[s]?)\.?$/i.test(text))
    return null;
  return text;
}

async function scrapeRRCC(): Promise<Record<string, PrereqEntry>> {
  console.log(`\nSOURCE 1 — Red Rocks CC (${RRCC_BASE})`);
  const idx = await retryFetch(RRCC_INDEX);
  if (!idx) {
    console.error("  ! failed to fetch RRCC index");
    return {};
  }
  const subjectUrls = rrccSubjectUrls(idx);
  console.log(`  [1/3] ${subjectUrls.length} subjects`);

  const courses: { url: string; code: string }[] = [];
  const seenUrl = new Set<string>();
  await pmap(subjectUrls, 5, async (su) => {
    const sh = await retryFetch(su);
    if (!sh) return;
    for (const c of rrccCourseUrls(sh)) {
      if (seenUrl.has(c.url)) continue;
      seenUrl.add(c.url);
      courses.push(c);
    }
  });
  console.log(`  [2/3] ${courses.length} course pages discovered`);

  const out: Record<string, PrereqEntry> = {};
  let withReq = 0;
  await pmap(courses, 8, async (c) => {
    const html = await retryFetch(c.url);
    if (!html) return;
    const text = rrccPrereq(html);
    if (!text) return;
    out[c.code] = { text, courses: extractRefdCourses(text, c.code) };
    withReq++;
  });
  console.log(`  [3/3] ${withReq} courses with a real prerequisite`);
  return out;
}

// ---------------------------------------------------------------------------
// SOURCE 2 — Community College of Denver (CourseLeaf)
// ---------------------------------------------------------------------------

const CCD_BASE = "https://catalog.ccd.edu";
const CCD_INDEX = `${CCD_BASE}/programs-courses/courses/`;

function ccdSubjectUrls(html: string): string[] {
  const re = /href="(\/programs-courses\/courses\/[a-z]+\/)"/gi;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) urls.add(CCD_BASE + m[1]);
  return Array.from(urls);
}

/** Parse all courseblocks on a CCD subject page → {code, prereqText|null}. */
function ccdCourseblocks(html: string): { code: string; text: string }[] {
  const out: { code: string; text: string }[] = [];
  // Each course is a <div class="courseblock"> ... </div>; split on the marker.
  const parts = html.split(/<div class="courseblock"/i).slice(1);
  for (const part of parts) {
    const titleM = part.match(
      /<p class="courseblocktitle"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i,
    );
    if (!titleM) continue;
    // Title looks like "BIO 2101 | Anatomy & Physiology II: GT-SC1"
    const titleText = cleanText(titleM[1]);
    const codeM = titleText.match(/^([A-Z]{2,4})\s?-?\s?(\d{3,4})/);
    if (!codeM) continue;
    const code = `${codeM[1]} ${codeM[2]}`;

    const reqM = part.match(
      /<p class="courseblockreqs[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (!reqM) continue;
    let text = cleanText(reqM[1]);
    // Drop the leading "Prerequisite:" / "Prerequisites:" label.
    text = text.replace(/^\s*Pre-?requisite[s]?\s*:?\s*/i, "").trim();
    if (!text) continue;
    if (/^(none|n\/a|not applicable|no prerequisite[s]?)\.?$/i.test(text))
      continue;
    out.push({ code, text });
  }
  return out;
}

async function scrapeCCD(): Promise<Record<string, PrereqEntry>> {
  console.log(`\nSOURCE 2 — Community College of Denver (${CCD_BASE})`);
  const idx = await retryFetch(CCD_INDEX);
  if (!idx) {
    console.error("  ! failed to fetch CCD index");
    return {};
  }
  const subjectUrls = ccdSubjectUrls(idx);
  console.log(`  [1/2] ${subjectUrls.length} subjects`);

  const out: Record<string, PrereqEntry> = {};
  let withReq = 0;
  await pmap(subjectUrls, 5, async (su) => {
    const sh = await retryFetch(su);
    if (!sh) return;
    for (const cb of ccdCourseblocks(sh)) {
      out[cb.code] = {
        text: cb.text,
        courses: extractRefdCourses(cb.text, cb.code),
      };
      withReq++;
    }
  });
  console.log(`  [2/2] ${withReq} courses with a real prerequisite`);
  return out;
}

// ---------------------------------------------------------------------------
// Merge + validate + write
// ---------------------------------------------------------------------------

async function main() {
  const rrcc = await scrapeRRCC();
  const ccd = await scrapeCCD();

  const rrccKeys = Object.keys(rrcc).length;
  const ccdKeys = Object.keys(ccd).length;

  // Merge: CCNS shared numbering means same code = same key.
  // On conflict, prefer the longer / more-complete text.
  const merged: Record<string, PrereqEntry> = { ...rrcc };
  let overlap = 0;
  for (const [code, entry] of Object.entries(ccd)) {
    if (!merged[code]) {
      merged[code] = entry;
    } else {
      overlap++;
      if (entry.text.length > merged[code].text.length) merged[code] = entry;
    }
  }

  // Drop any entry whose text still contains "<" (HTML contamination guard).
  for (const [code, entry] of Object.entries(merged)) {
    if (entry.text.includes("<")) {
      console.warn(`  dropping HTML-contaminated entry: ${code}`);
      delete merged[code];
    }
  }

  // Sort keys for stable output.
  const sorted: Record<string, PrereqEntry> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];

  const outPath = path.join(process.cwd(), "data", "co", "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));

  const total = Object.keys(sorted).length;
  console.log(`\n=== MERGE SUMMARY ===`);
  console.log(`  RRCC source:        ${rrccKeys} keys`);
  console.log(`  CCD source:         ${ccdKeys} keys`);
  console.log(`  Overlapping codes:  ${overlap} (CCNS shared numbering)`);
  console.log(`  Merged total:       ${total} keys → ${outPath}`);

  // Validate: 0 entries contain "<" in text.
  const reloaded: Record<string, PrereqEntry> = JSON.parse(
    fs.readFileSync(outPath, "utf-8"),
  );
  const htmlBad = Object.entries(reloaded).filter(([, e]) =>
    e.text.includes("<"),
  );
  console.log(`\n=== VALIDATION ===`);
  console.log(`  Total keys:           ${Object.keys(reloaded).length}`);
  console.log(`  Entries with "<":     ${htmlBad.length} (must be 0)`);
  if (htmlBad.length > 0) {
    console.error("  ! HTML contamination present:", htmlBad.map((e) => e[0]));
    process.exit(1);
  }
  console.log(`\n  5 sample entries:`);
  for (const k of Object.keys(reloaded).slice(0, 5)) {
    console.log(`    ${k}: ${JSON.stringify(reloaded[k])}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
