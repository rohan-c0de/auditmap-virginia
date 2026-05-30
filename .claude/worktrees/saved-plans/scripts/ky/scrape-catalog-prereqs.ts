/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes KCTCS's CourseLeaf catalog at https://catalog.kctcs.edu to
 * extract prerequisite text for every course in the system-wide catalog.
 * KCTCS (Kentucky Community & Technical College System) uses a single
 * centralized catalog covering all 16 colleges with common course numbering.
 *
 * CourseLeaf organizes courses by subject — each subject has a page at
 * /course-descriptions/{subject}/ containing all courses as
 * `<div class="courseblock">` elements. Prerequisites live in a
 * `<div class="section__content">` block labeled `<strong>Pre-requisite:</strong>`.
 * Course cross-references use `<a class="bubblelink code">` anchors whose
 * text contains the readable course code (e.g. "MAT 150").
 *
 * Flow:
 *   1. Fetch /course-descriptions/ to discover all subject slugs.
 *   2. For each subject page, parse all courseblocks and extract
 *      prereq text + referenced course codes.
 *   3. Write data/ky/prereqs.json keyed by "${PREFIX} ${NUMBER}".
 *
 * Usage:
 *   npx tsx scripts/ky/scrape-catalog-prereqs.ts
 *   npx tsx scripts/ky/scrape-catalog-prereqs.ts --limit=5   # smoke test (5 subjects)
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://catalog.kctcs.edu";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 4;
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

function discoverSubjects(html: string): string[] {
  const matches = html.match(/href="\/course-descriptions\/([a-z]+)\/"/g) || [];
  const slugs = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/\/course-descriptions\/([a-z]+)\//);
    if (mm) slugs.add(mm[1]);
  }
  return Array.from(slugs).sort();
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
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

const BOILERPLATE_RE =
  /^(none|not applicable|n\/a|no prerequisites?)\s*\.?\s*$/i;

function parseSubjectPage(html: string): Map<string, PrereqEntry> {
  const results = new Map<string, PrereqEntry>();

  // Split on courseblock boundaries
  const blocks = html.split(/<div class="courseblock">/);
  blocks.shift(); // discard content before first courseblock

  for (const block of blocks) {
    // Extract course code from detail-code span
    const codeMatch = block.match(
      /<span[^>]*class="[^"]*detail-code[^"]*"[^>]*>\s*<strong>\s*([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)\s*<\/strong>/,
    );
    if (!codeMatch) continue;
    const prefix = codeMatch[1].toUpperCase();
    const number = codeMatch[2];
    const key = `${prefix} ${number}`;

    // Look for Pre-requisite section (handles "Pre-requisite:", "Pre- or co-requisite:")
    const prereqMatch = block.match(
      /<strong>\s*Pre-?\s*(?:requisite|or co-requisite)\s*:?\s*<\/strong>\s*([\s\S]*?)(?:<\/div>)/i,
    );
    if (!prereqMatch) continue;

    const rawBlock = prereqMatch[1];
    const text = htmlToText(rawBlock);
    if (!text || BOILERPLATE_RE.test(text)) continue;

    // Extract course codes from bubblelink anchors and plain text
    const courses = new Set<string>();

    // From <a class="bubblelink code"> anchor text
    const anchorRegex = /<a[^>]*class="[^"]*bubblelink[^"]*"[^>]*>([^<]+)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = anchorRegex.exec(rawBlock)) !== null) {
      const anchorText = m[1].trim();
      const codeInAnchor = anchorText.match(/^([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)$/);
      if (codeInAnchor) {
        const code = `${codeInAnchor[1]} ${codeInAnchor[2]}`;
        if (code !== key) courses.add(code);
      }
    }

    // Also scan plain text for course codes the anchors might miss
    const codeRegex = /\b([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)\b/g;
    while ((m = codeRegex.exec(text)) !== null) {
      const code = `${m[1]} ${m[2]}`;
      if (code !== key && code !== "ACT 19" && code !== "ACT 22" && code !== "ACT 27" &&
          !code.startsWith("ACT ") && !code.startsWith("SAT ") && !code.startsWith("GPA ")) {
        courses.add(code);
      }
    }

    results.set(key, { text, courses: Array.from(courses).sort() });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

  console.log("KCTCS CourseLeaf catalog prereq scraper");
  console.log(`  Base: ${BASE}`);

  // --- Phase 1: discover subject slugs ---
  console.log("\n[1/2] Discovering subject slugs...");
  const indexHtml = await retryFetch(`${BASE}/course-descriptions/`, "subject-index");
  let subjects = discoverSubjects(indexHtml);
  console.log(`  Found ${subjects.length} subjects`);

  if (limit > 0) {
    subjects = subjects.slice(0, limit);
    console.log(`  Limited to first ${limit} for smoke test`);
  }

  // --- Phase 2: fetch each subject page, parse courseblocks ---
  console.log("\n[2/2] Fetching subject pages + parsing prereqs...");
  const prereqs: Record<string, PrereqEntry> = {};
  let totalCourses = 0;
  let withPrereqs = 0;

  await pmap(subjects, CONCURRENCY, async (subject, idx) => {
    const url = `${BASE}/course-descriptions/${subject}/`;
    const html = await retryFetch(url, `subject(${subject})`);
    if (!html) return;

    const parsed = parseSubjectPage(html);
    for (const [key, entry] of parsed) {
      if (!prereqs[key]) {
        prereqs[key] = entry;
        withPrereqs++;
      }
    }
    totalCourses += (html.match(/<div class="courseblock">/g) || []).length;

    if ((idx + 1) % 20 === 0) {
      console.log(`  ${idx + 1}/${subjects.length} subjects (${withPrereqs} prereqs so far)`);
    }
  });
  console.log(`  Processed ${subjects.length} subjects, ~${totalCourses} total courses`);
  console.log(`  Extracted prereqs for ${withPrereqs} courses`);

  // Sort keys alphabetically
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(prereqs).sort()) {
    sorted[key] = prereqs[key];
  }

  // --- Write ---
  const outDir = path.join(process.cwd(), "data", "ky");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
