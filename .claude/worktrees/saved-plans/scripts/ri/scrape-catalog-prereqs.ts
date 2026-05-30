/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes Community College of Rhode Island's CourseLeaf catalog at
 * https://catalog.ccri.edu to extract prerequisite text for every active
 * CCRI course. CCRI is RI's only community college; the primary course
 * scraper (scripts/ri/scrape-banner8.ts) doesn't extract prereqs from
 * Banner 8's legacy HTML forms, so this catalog scrape fills the gap.
 *
 * CCRI uses CourseLeaf, not acalog — a different engine than VT/TN/CT.
 * Courses are grouped by subject prefix: each subject has its own page at
 * `/course-descriptions/{subj}/` (e.g. `/course-descriptions/acct/`) with
 * all that subject's courses rendered inline as `<div class="courseblock">`
 * blocks. Prereqs live in `<span class="text detail-prereqs">` with course
 * codes as the anchor text inside `<a class="bubblelink code">` links —
 * much cleaner than acalog's coid-indirected links.
 *
 * Flow:
 *   1. GET /course-descriptions/ to enumerate subject slugs
 *   2. For each subject page, split on `<div class="courseblock">` and
 *      parse each block for { code, prereq text, prereq course codes }
 *   3. Write data/ri/prereqs.json keyed by "${PREFIX} ${NUMBER}"
 *
 * Usage:
 *   npx tsx scripts/ri/scrape-catalog-prereqs.ts
 *   npx tsx scripts/ri/scrape-catalog-prereqs.ts --limit-subjects=3   # smoke test
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://catalog.ccri.edu";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 100;

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
        return ""; // 404 — skip
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
// Parsing
// ---------------------------------------------------------------------------

/** Extract subject slugs from the top-level course-descriptions index page. */
function extractSubjectSlugs(html: string): string[] {
  const matches = html.match(/\/course-descriptions\/([a-z]{2,6})\//g) || [];
  const slugs = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/\/course-descriptions\/([a-z]{2,6})\//);
    if (mm) slugs.add(mm[1]);
  }
  return Array.from(slugs).sort();
}

/** Decode common HTML entities + strip tags → plain text, single-spaced. */
function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
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

const BOILERPLATE_RE =
  /^(none|n\/a|not applicable|see course description|placement by|placement test)\s*\.?\s*$/i;

/**
 * Parse one CourseLeaf course block. Returns { prefix, number, text, courses }
 * or null if the block has no prereq or doesn't parse.
 *
 * HTML structure (verified against CCRI ACCT 1030):
 *   <div class="courseblock">
 *     <div class="cols noindent">
 *       <span class="... detail-code ...">
 *         <strong>ACCT 1030</strong>
 *       </span>
 *       <span class="... detail-title ...">
 *         <strong>- Computerized Accounting</strong>
 *       </span>
 *     </div>
 *     ...
 *     <span class="text detail-prereqs">
 *       <strong>Prerequisite(s): </strong>
 *       <a ... class="bubblelink code" ...>ACCT 1010</a>
 *       <br/>
 *     </span>
 *     ...
 *   </div>
 */
function parseCourseBlock(block: string): {
  prefix: string;
  number: string;
  text: string;
  courses: string[];
} | null {
  // --- Course code ---
  // The code appears as `<strong>PREFIX NUMBER</strong>` inside detail-code.
  const codeMatch = block.match(
    /detail-code[^>]*>\s*<strong>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*<\/strong>/,
  );
  if (!codeMatch) return null;
  const prefix = codeMatch[1].toUpperCase();
  const number = codeMatch[2];

  // --- Prereq span ---
  const prereqMatch = block.match(
    /<span[^>]*detail-prereqs[^>]*>([\s\S]*?)<\/span>/,
  );
  if (!prereqMatch) return null;

  // Extract plain text (for the `text` field)
  const text = htmlToText(
    // Strip the "Prerequisite(s): " header label — we don't want to repeat it
    prereqMatch[1].replace(
      /<strong>\s*Prerequisites?(?:\(s\))?\s*:\s*<\/strong>/i,
      "",
    ),
  );
  if (!text) return null;
  if (BOILERPLATE_RE.test(text)) return null;

  // Extract all bubble-link course codes from the prereq span. CourseLeaf
  // emits `class="bubblelink code"` on every course-to-course link, which
  // gives us a reliable extraction even when the surrounding text has AND/OR
  // prose. Exclude the course's own code.
  const courses = new Set<string>();
  const linkRegex = /class="[^"]*bubblelink\s+code[^"]*"[^>]*>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*</g;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(prereqMatch[1])) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code !== `${prefix} ${number}`) courses.add(code);
  }

  // Fallback: also match any inline `PREFIX NUMBER` in the text itself.
  // Handles cases where CourseLeaf didn't wrap a reference in a bubblelink.
  const fallbackRegex = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;
  while ((m = fallbackRegex.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code !== `${prefix} ${number}`) courses.add(code);
  }

  return { prefix, number, text, courses: Array.from(courses).sort() };
}

/** Split a subject page into `<div class="courseblock">` segments. */
function extractCourseBlocks(subjectHtml: string): string[] {
  // Split on the opening tag; the first fragment is pre-blocks boilerplate.
  const parts = subjectHtml.split(/<div[^>]*class="[^"]*courseblock[^"]*"/);
  return parts.slice(1); // drop the pre-block preamble
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limitSubjects = parseInt(
    args.find((a) => a.startsWith("--limit-subjects="))?.split("=")[1] || "0",
    10,
  );

  console.log("CCRI catalog prereq scraper");
  console.log(`  Base: ${BASE}`);

  // --- Phase 1: enumerate subjects ---
  console.log("\n[1/2] Enumerating subjects from /course-descriptions/ ...");
  const indexHtml = await retryFetch(`${BASE}/course-descriptions/`, "index");
  let subjects = extractSubjectSlugs(indexHtml);
  console.log(`  Found ${subjects.length} subject slugs`);

  if (limitSubjects > 0) {
    subjects = subjects.slice(0, limitSubjects);
    console.log(`  Limited to first ${limitSubjects} for smoke test`);
  }

  // --- Phase 2: fetch each subject page + parse all course blocks ---
  console.log("\n[2/2] Fetching subject pages...");
  const prereqs: Record<string, PrereqEntry> = {};
  let totalBlocks = 0;
  let withPrereqs = 0;

  await pmap(subjects, CONCURRENCY, async (subj) => {
    const html = await retryFetch(
      `${BASE}/course-descriptions/${subj}/`,
      `subject(${subj})`,
    );
    if (!html) return;
    const blocks = extractCourseBlocks(html);
    totalBlocks += blocks.length;

    for (const block of blocks) {
      const parsed = parseCourseBlock(block);
      if (!parsed) continue;
      const key = `${parsed.prefix} ${parsed.number}`;
      if (prereqs[key]) continue;
      prereqs[key] = { text: parsed.text, courses: parsed.courses };
      withPrereqs++;
    }
  });

  console.log(`  Parsed ${totalBlocks} course blocks across ${subjects.length} subjects`);
  console.log(`  Extracted prereqs for ${withPrereqs} courses`);

  // Sort keys alphabetically for deterministic output
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(prereqs).sort()) {
    sorted[key] = prereqs[key];
  }

  // --- Write ---
  const outDir = path.join(process.cwd(), "data", "ri");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
