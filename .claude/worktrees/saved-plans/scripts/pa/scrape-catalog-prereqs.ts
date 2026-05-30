/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes Community College of Philadelphia's Drupal-based catalog at
 * https://www.ccp.edu/college-catalog/course-offerings to extract
 * prerequisite data. CCP is the largest community college in PA (~20k
 * students) and PA has no course data at all today (data/pa/courses is
 * empty), so this scraper gives PA its first prereq source.
 *
 * CCP uses a custom Drupal site — neither acalog nor CourseLeaf nor
 * Coursedog — so this is a new parser. Structure (verified against the
 * Accounting subject page):
 *
 *   <div class="views-row">
 *     <h2><span>ACCT 102 - Financial Accounting</span></h2>
 *     ...
 *     <h3 class="h2">Prerequisite</h3>
 *     <p><a href="/node/2610">ACCT 101</a> with grade of "C" or better.</p>
 *     ...
 *   </div>
 *
 * Course code is the H2's span text ("PREFIX NUMBER - Title"). Prereqs
 * appear as inline text in the <p> after the <h3>; course references are
 * usually wrapped in `<a class="colorbox-load">` with the course code as
 * anchor text, so the extraction is single-pass (no coid-indirection like
 * VT/CT).
 *
 * Output: data/pa/prereqs.json keyed by "${PREFIX} ${NUMBER}".
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-catalog-prereqs.ts
 *   npx tsx scripts/pa/scrape-catalog-prereqs.ts --limit-subjects=3   # smoke test
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://www.ccp.edu";
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
// Parsing
// ---------------------------------------------------------------------------

/** Extract subject URLs from the course-offerings root page. */
function extractSubjectUrls(html: string): string[] {
  const matches = html.match(/\/college-catalog\/course-offerings\/[^"'?#]+/g) || [];
  const slugs = new Set<string>();
  for (const m of matches) {
    // Skip the index itself
    if (m === "/college-catalog/course-offerings/") continue;
    if (m === "/college-catalog/course-offerings") continue;
    slugs.add(m);
  }
  return Array.from(slugs).sort();
}

/** Split a subject page into <div class="views-row"> course segments. */
function extractCourseBlocks(subjectHtml: string): string[] {
  const parts = subjectHtml.split(/<div[^>]*class="[^"]*views-row[^"]*"/);
  return parts.slice(1);
}

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
  /^(none|n\/a|not applicable|see course description)\s*\.?\s*$/i;

function parseCourseBlock(block: string): {
  prefix: string;
  number: string;
  text: string;
  courses: string[];
} | null {
  // --- Code: <h2><span>ACCT 102 - Financial Accounting</span></h2> ---
  const codeMatch = block.match(
    /<h2[^>]*>[\s\S]*?<span[^>]*>\s*([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\s*-/,
  );
  if (!codeMatch) return null;
  const prefix = codeMatch[1].toUpperCase();
  const number = codeMatch[2];

  // --- Prereq block: <h3>Prerequisite(s)?</h3><p>...</p> ---
  // CCP's structure is the H3 followed by exactly one <p> with the prereq
  // text. Any <p> after that (e.g. "Course Offered Online: Yes") is a
  // different metadata field, so stop at the first </p>.
  const prereqMatch = block.match(
    /<h3[^>]*>\s*Prerequisites?\s*<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
  );
  if (!prereqMatch) return null;

  const text = htmlToText(prereqMatch[1]);
  if (!text) return null;
  if (BOILERPLATE_RE.test(text)) return null;

  // Extract course codes from the text. CCP's prereq text is plain prose
  // with codes like "ACCT 101" (typically wrapped in <a class="colorbox-load">
  // in the HTML, but htmlToText strips the tags).
  const courses = new Set<string>();
  const codeRegex = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code !== `${prefix} ${number}`) courses.add(code);
  }

  return { prefix, number, text, courses: Array.from(courses).sort() };
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

  console.log("CCP (PA) catalog prereq scraper");
  console.log(`  Base: ${BASE}`);

  // --- Phase 1: enumerate subjects ---
  console.log("\n[1/2] Enumerating subjects from /college-catalog/course-offerings ...");
  const indexHtml = await retryFetch(
    `${BASE}/college-catalog/course-offerings`,
    "index",
  );
  let subjects = extractSubjectUrls(indexHtml);
  console.log(`  Found ${subjects.length} subject URLs`);

  if (limitSubjects > 0) {
    subjects = subjects.slice(0, limitSubjects);
    console.log(`  Limited to first ${limitSubjects} for smoke test`);
  }

  // --- Phase 2: fetch each subject page + parse all course blocks ---
  console.log("\n[2/2] Fetching subject pages...");
  const prereqs: Record<string, PrereqEntry> = {};
  let totalBlocks = 0;
  let withPrereqs = 0;

  await pmap(subjects, CONCURRENCY, async (subjPath) => {
    const html = await retryFetch(`${BASE}${subjPath}`, `subject(${subjPath})`);
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

  console.log(
    `  Parsed ${totalBlocks} course blocks across ${subjects.length} subjects`,
  );
  console.log(`  Extracted prereqs for ${withPrereqs} courses`);

  // Sort keys alphabetically for deterministic output
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(prereqs).sort()) {
    sorted[key] = prereqs[key];
  }

  // --- Write ---
  const outDir = path.join(process.cwd(), "data", "pa");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
