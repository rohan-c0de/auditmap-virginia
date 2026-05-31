/**
 * scrape-smartcatalogiq-prereqs.ts — shared SmartCatalogIQ prereq scraper.
 *
 * SmartCatalogIQ catalogs (.smartcatalogiq.com) render course prereqs in
 * raw server-rendered HTML inside `<div class="sc_prereqs">` blocks — no
 * JS execution needed despite the dynamic catalog feel. Pages do show a
 * "Prerequisite" label even when the prereq text is empty (some courses
 * have no prereq); we filter those out.
 *
 * Navigation pattern (3-level walk):
 *   {base}/{year}/{catalog}/{coursesPath}                  ← subject index
 *   {base}/{year}/{catalog}/{coursesPath}/{subject-slug}   ← level groups (100, 200)
 *   {base}/{year}/{catalog}/{coursesPath}/{subject}/{lvl}/{course-id}
 *
 * Used by:
 *   - ma/berkshire        (catalog=catalog,         year=2024-2025, courses=courses)
 *   - ma/necc             (catalog=catalog,         year=2026-2027, courses=courses)
 *   - ma/northshore       (catalog=college-catalog, year=2025-2026, courses=course-description)
 *   - ny/suny-adirondack  (catalog=college-catalog, year=24-25,     courses=course-descriptions)
 *   - ny/rockland-cc      (catalog=catalog,         year=2025-2026, courses=courses)
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SciqConfig {
  /** Output college slug — what gets written as the prereq source */
  collegeSlug: string;
  /** State slug (ma, ny, …) — controls output path data/{state}/prereqs.json */
  state: string;
  /** Subdomain on smartcatalogiq.com (no protocol) */
  subdomain: string;
  /** Catalog year, e.g. "2024-2025" or "24-25" */
  year: string;
  /** Catalog slug under /en/{year}/ — typically "catalog" or "college-catalog" */
  catalogPath: string;
  /** Courses index path — typically "courses", "course-description", or "course-descriptions" */
  coursesPath: string;
}

export interface PrereqEntry {
  text: string;
  courses: string[];
}

interface CourseUrl {
  prefix: string;
  number: string;
  url: string;
}

async function retryFetch(
  url: string,
  attempts = 3,
): Promise<string | null> {
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
  delayMs = 80,
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
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Extract subject-page URLs from the courses index page. */
function extractSubjectUrls(html: string, baseUrl: string): string[] {
  // Sidebar: <li><a href="/en/.../courses/acc-accounting">ACC - ACCOUNTING</a></li>
  // Plus main body shows subjects too. Filter to slug-pattern hrefs.
  const re = /href="(\/[^"]*\/courses?[^"]*?\/[a-z]{2,5}-[a-z][^"\/]*)"/gi;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Skip URLs with deeper paths (level/course)
    const path = m[1].split("/").filter(Boolean);
    // Expect: ["en", year, catalog, coursesPath, "{prefix}-{name}"]
    if (path.length === 5) {
      urls.add(baseUrl + m[1]);
    }
  }
  return Array.from(urls);
}

/** Extract level-group URLs (100, 200, etc.) from a subject page. */
function extractLevelUrls(
  html: string,
  baseUrl: string,
  subjectPath: string,
): string[] {
  // /en/.../courses/{subject-slug}/100
  const escSubj = subjectPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`href="(${escSubj}\\/(\\d{3}))"`, "g");
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) urls.add(baseUrl + m[1]);
  return Array.from(urls);
}

/** Extract individual course URLs from a level page. */
function extractCourseUrls(
  html: string,
  baseUrl: string,
  levelPath: string,
): { url: string; code: string }[] {
  const escLvl = levelPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // /en/.../courses/{subject-slug}/100/acc-101 — final segment is the course ID
  const re = new RegExp(
    `href="(${escLvl}\\/([a-z]{2,5}-?\\d{3,4}[a-z]?))"`,
    "gi",
  );
  const results: { url: string; code: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    results.push({ url: baseUrl + m[1], code: m[2] });
  }
  return results;
}

/** Extract clean prereq text from a course detail page. */
function extractPrereq(html: string): string | null {
  // <div class="sc_prereqs">...Prerequisite</h3>{TEXT}<otherTag>
  const m = html.match(
    /<div\s+class="sc_prereqs"[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!m) return null;
  // Strip the "Prerequisite" heading and clean up
  const inner = m[1]
    .replace(/<h[1-6][^>]*>\s*Pre-?requisite[s]?\s*<\/h[1-6]>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!inner) return null;
  // Filter out boilerplate
  if (/^(none|n\/a|not applicable)\s*\.?\s*$/i.test(inner)) return null;
  return inner;
}

/** Parse a course code like "ACC101" or "ACC-101" into prefix/number. */
function parseCode(code: string): { prefix: string; number: string } | null {
  const m = code.toUpperCase().match(/^([A-Z]{2,5})-?(\d{3,4}[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

/** Extract course codes referenced in prereq text. */
function extractRefdCourses(text: string, selfCode: string): string[] {
  const codes = new Set<string>();
  // Match codes like ACC101, ACC-101, ACC 101
  const re = /\b([A-Z]{2,5})[\s-]?(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = `${m[1]} ${m[2]}`;
    if (c !== selfCode) codes.add(c);
  }
  return Array.from(codes).sort();
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeSciqPrereqs(
  config: SciqConfig,
): Promise<{ prereqs: Record<string, PrereqEntry>; courseCount: number }> {
  const baseUrl = `https://${config.subdomain}.smartcatalogiq.com`;
  const indexUrl = `${baseUrl}/en/${config.year}/${config.catalogPath}/${config.coursesPath}`;

  console.log(`\n${config.collegeSlug} (${baseUrl})`);
  console.log(`  Index: ${indexUrl}`);

  // 1. Subject index
  const idxHtml = await retryFetch(indexUrl);
  if (!idxHtml) {
    console.error(`  ! Failed to fetch courses index`);
    return { prereqs: {}, courseCount: 0 };
  }
  const subjectUrls = extractSubjectUrls(idxHtml, baseUrl);
  console.log(`  [1/3] ${subjectUrls.length} subjects`);

  // 2. Subject pages → level URLs → course URLs
  const allCourses: CourseUrl[] = [];
  await pmap(subjectUrls, 4, async (subjectUrl) => {
    const subjHtml = await retryFetch(subjectUrl);
    if (!subjHtml) return;
    const subjectPath = subjectUrl.replace(baseUrl, "");
    const levelUrls = extractLevelUrls(subjHtml, baseUrl, subjectPath);
    // For each level, fetch its page to get course URLs
    for (const levelUrl of levelUrls) {
      const lvlHtml = await retryFetch(levelUrl);
      if (!lvlHtml) continue;
      const levelPath = levelUrl.replace(baseUrl, "");
      const courses = extractCourseUrls(lvlHtml, baseUrl, levelPath);
      for (const c of courses) {
        const parsed = parseCode(c.code);
        if (parsed) {
          allCourses.push({
            prefix: parsed.prefix,
            number: parsed.number,
            url: c.url,
          });
        }
      }
      await sleep(50);
    }
  });
  console.log(`  [2/3] ${allCourses.length} courses across all subjects`);

  // 3. Fetch each course page → extract prereq
  const prereqs: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;
  await pmap(allCourses, 6, async (course) => {
    const html = await retryFetch(course.url);
    if (!html) return;
    const text = extractPrereq(html);
    if (!text) return;
    const selfCode = `${course.prefix} ${course.number}`;
    const refdCourses = extractRefdCourses(text, selfCode);
    prereqs[selfCode] = { text, courses: refdCourses };
    withPrereqs++;
  });
  console.log(`  [3/3] ${withPrereqs} courses with prereqs`);

  return { prereqs, courseCount: allCourses.length };
}

/**
 * Run multiple SCIQ scrapes and merge into the state's prereqs.json.
 * Merges additively: preserves entries from other source scrapers.
 */
export async function scrapeAndMergeSciq(
  state: string,
  configs: SciqConfig[],
): Promise<void> {
  const outPath = path.join(process.cwd(), "data", state, "prereqs.json");
  let existing: Record<string, PrereqEntry> = {};
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {}
  const before = Object.keys(existing).length;

  let newCount = 0;
  let upgradedCount = 0;
  let totalCourses = 0;

  for (const config of configs) {
    const { prereqs, courseCount } = await scrapeSciqPrereqs(config);
    totalCourses += courseCount;
    for (const [key, entry] of Object.entries(prereqs)) {
      if (!existing[key]) {
        existing[key] = entry;
        newCount++;
      } else if (
        entry.courses.length > (existing[key].courses?.length ?? 0)
      ) {
        existing[key] = entry;
        upgradedCount++;
      }
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(existing).sort()) {
    sorted[key] = existing[key];
  }
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(
    `\n✓ ${state}/prereqs.json: ${before} → ${Object.keys(sorted).length} (${newCount} new, ${upgradedCount} upgraded) across ${configs.length} colleges (${totalCourses} catalog courses)`,
  );
}
