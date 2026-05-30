/**
 * Texas — CourseLeaf catalog → prereqs scrape (2 colleges)
 *
 * Two TX community colleges publish their course catalog via CourseLeaf
 * but don't expose a public class-section endpoint. The course detail
 * pages embed a "Prerequisite(s): ..." sentence that's enough to populate
 * the semester planner's prereq chain.
 *
 * Two scrape patterns covered — CourseLeaf catalogs vary by deployment:
 *
 *   san-jacinto-community-college  publications.sanjac.edu
 *     - Layout: subject-pages with multiple `<div class="courseblock">`
 *       blocks per page.
 *     - Pattern: fetch /courses-az/ → enumerate subject sub-pages →
 *       parse all courseblocks in each.
 *
 *   grayson-college                catalog.grayson.edu/2026-2027/
 *     - Layout: per-course detail pages, no subject summary pages.
 *     - Pattern: fetch /courses/ → enumerate course detail URLs →
 *       fetch each detail page.
 *
 * Output: merges new prereq entries into data/tx/prereqs.json without
 * clobbering existing entries from section scrapers, Coursedog catalogs,
 * or the Acalog scraper (scripts/tx/scrape-acalog-prereqs.ts).
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-courseleaf-prereqs.ts
 *   npx tsx scripts/tx/scrape-courseleaf-prereqs.ts --college=grayson-college
 *   npx tsx scripts/tx/scrape-courseleaf-prereqs.ts --limit=20
 */
import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 60;

interface PrereqEntry {
  text: string;
  courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string, label: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        await sleep(500 * (i + 1));
        continue;
      }
      throw new Error(`HTTP ${res.status} on ${label}`);
    } catch (e) {
      if (i === 2) {
        console.warn(`  ⚠ ${label} failed: ${e}`);
        return "";
      }
      await sleep(500 * (i + 1));
    }
  }
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

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
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

/**
 * Pull a "Prerequisite(s): ..." sentence out of a block of plain text.
 * Stops at the next labeled section (Co-requisite, Restrictions, Course
 * Type, ...) or a sentence-ending period followed by a capital letter.
 */
function extractPrereqText(text: string): string | null {
  const m = text.match(
    /Pre-?requisite\s*\(?s?\)?\s*[:\s]\s*([^\.]+?)(?=\s+(?:Co-?requisite|Restrictions?|Course\s+Type|Catalog\s+Year|Sections?|\Z)|\.\s+[A-Z])/i
  );
  if (m) return m[1].trim();
  // Looser fallback: take up to 400 chars after "Prerequisite:".
  const m2 = text.match(/Pre-?requisite\s*\(?s?\)?\s*[:\s]\s*([^\.]{1,400})/i);
  return m2 ? m2[1].trim() : null;
}

const BOILERPLATE_RE =
  /^(none|not applicable|n\/a|no prerequisites?|reading level\s+\d+\s*,?\s*writing level\s+\d+\s*,?\s*math level\s+\d+)\s*\.?\s*$/i;

function extractCourseCodes(text: string, ownCode: string): string[] {
  const codes = new Set<string>();
  const re = /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code !== ownCode) codes.add(code);
  }
  return Array.from(codes).sort();
}

// ---------------------------------------------------------------------------
// Pattern A: courseblock divs in subject pages (San Jacinto)
// ---------------------------------------------------------------------------

interface CourseblockConfig {
  pattern: "courseblock-subject-pages";
  base: string;            // catalog root
  indexPath: string;       // /courses-az/
  subjectLinkRegex: RegExp; // matches the relative subject path
}

async function scrapeCourseblockSubjects(
  config: CourseblockConfig
): Promise<Map<string, PrereqEntry>> {
  const indexHtml = await fetchHtml(config.base + config.indexPath, "index");
  const subjects = Array.from(
    new Set(
      Array.from(indexHtml.matchAll(config.subjectLinkRegex), (m) => m[1])
    )
  );
  console.log(`  ${subjects.length} subjects`);
  const prereqs = new Map<string, PrereqEntry>();
  await pmap(subjects, CONCURRENCY, async (subject) => {
    const subjUrl = config.base + config.indexPath + subject + "/";
    const html = await fetchHtml(subjUrl, `subject(${subject})`);
    if (!html) return;
    // Each <div class="courseblock"> wraps one course
    const blockRe =
      /<div\s+class="courseblock"[^>]*>([\s\S]{200,8000}?)(?=<div\s+class="courseblock"|<\/main|<footer)/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null) {
      const blockText = htmlToText(m[1]);
      const codeMatch = blockText.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/);
      if (!codeMatch) continue;
      const code = `${codeMatch[1]} ${codeMatch[2]}`;
      if (prereqs.has(code)) continue;
      const prereqText = extractPrereqText(blockText);
      if (!prereqText) continue;
      if (BOILERPLATE_RE.test(prereqText)) continue;
      const courses = extractCourseCodes(prereqText, code);
      if (!prereqText.trim() && courses.length === 0) continue;
      prereqs.set(code, { text: prereqText.trim(), courses });
    }
  });
  return prereqs;
}

// ---------------------------------------------------------------------------
// Pattern B: per-course detail pages (Grayson)
// ---------------------------------------------------------------------------

interface DetailPagesConfig {
  pattern: "detail-pages";
  base: string;            // catalog root with year (e.g. /2026-2027)
  indexPath: string;       // /courses/
  detailLinkRegex: RegExp; // captures the absolute URL of each course-detail page
}

async function scrapeDetailPages(
  config: DetailPagesConfig
): Promise<Map<string, PrereqEntry>> {
  const indexHtml = await fetchHtml(config.base + config.indexPath, "index");
  const urls = Array.from(
    new Set(
      Array.from(indexHtml.matchAll(config.detailLinkRegex), (m) => m[1])
    )
  );
  console.log(`  ${urls.length} course detail pages`);
  const prereqs = new Map<string, PrereqEntry>();
  await pmap(urls, CONCURRENCY, async (url) => {
    const html = await fetchHtml(url, url.replace(config.base, ""));
    if (!html) return;
    const text = htmlToText(html);
    const codeMatch = text.match(/([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+-/);
    if (!codeMatch) return;
    const code = `${codeMatch[1]} ${codeMatch[2]}`;
    const prereqText = extractPrereqText(text);
    if (!prereqText) return;
    if (BOILERPLATE_RE.test(prereqText)) return;
    const courses = extractCourseCodes(prereqText, code);
    if (prereqs.has(code)) return;
    prereqs.set(code, { text: prereqText.trim(), courses });
  });
  return prereqs;
}

// ---------------------------------------------------------------------------
// Per-college config
// ---------------------------------------------------------------------------

type CollegeConfig = CourseblockConfig | DetailPagesConfig;

const COLLEGES: Record<string, { name: string; config: CollegeConfig }> = {
  "san-jacinto-community-college": {
    name: "San Jacinto College",
    config: {
      pattern: "courseblock-subject-pages",
      base: "https://publications.sanjac.edu",
      indexPath: "/courses-az/",
      // /courses-az/{subject}/ — relative paths from index page
      subjectLinkRegex: /href="\/courses-az\/([a-z]{2,5})\/"/g,
    },
  },
  "grayson-college": {
    name: "Grayson College",
    config: {
      pattern: "detail-pages",
      base: "https://catalog.grayson.edu/2026-2027",
      indexPath: "/courses/",
      // /2026-2027/courses/{subject}/{subject}-{number}.php — absolute URLs
      detailLinkRegex:
        /href="(https:\/\/catalog\.grayson\.edu\/2026-2027\/courses\/[a-z]{2,5}\/[a-z]{2,5}-\d{3,4}\.php)"/g,
    },
  },
};

async function main() {
  const args = process.argv.slice(2);
  const _limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
    10
  );
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("Texas CourseLeaf prereq scraper");

  const slugs = collegeFilter ? [collegeFilter] : Object.keys(COLLEGES);

  const outDir = path.join(process.cwd(), "data", "tx");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  let merged: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath)) {
    merged = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Loaded ${Object.keys(merged).length} existing prereqs`);
  }

  for (const slug of slugs) {
    const entry = COLLEGES[slug];
    if (!entry) {
      console.error(`Unknown college: ${slug}`);
      continue;
    }
    console.log(`\n--- ${entry.name} (${slug}) ---`);
    try {
      const prereqs =
        entry.config.pattern === "courseblock-subject-pages"
          ? await scrapeCourseblockSubjects(entry.config)
          : await scrapeDetailPages(entry.config);
      let added = 0;
      for (const [key, val] of prereqs) {
        if (!merged[key]) {
          merged[key] = val;
          added++;
        }
      }
      console.log(`  +${added} new (${prereqs.size - added} already known)`);
    } catch (e) {
      console.error(`  ⚠ ${slug} failed: ${e}`);
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
