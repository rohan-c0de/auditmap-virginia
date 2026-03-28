/**
 * scrape-vccs.ts
 *
 * Scrapes course section data from courses.vccs.edu for all 23 VCCS colleges.
 * Writes JSON files to data/courses/{slug}/{term}.json matching the CourseSection interface.
 *
 * Usage:
 *   npx tsx scripts/scrape-vccs.ts                    # scrape all colleges, current term
 *   npx tsx scripts/scrape-vccs.ts --college nova     # scrape one college
 *   npx tsx scripts/scrape-vccs.ts --term "Fall 2026" # scrape a specific term
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://courses.vccs.edu";
const DEFAULT_TERM = "Spring 2026";
const DELAY_MS = 100;
const FETCH_TIMEOUT_MS = 15000;
const CONCURRENCY = 5; // parallel course page fetches

const ALL_SLUGS = [
  "brcc", "brightpoint", "camp", "cvcc", "dcc", "escc", "gcc",
  "laurelridge", "mecc", "mgcc", "nrcc", "nova", "phcc", "pvcc",
  "rcc", "reynolds", "svcc", "swcc", "tcc", "vhcc", "vpcc", "vwcc", "wcc",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function termToCode(termName: string): string {
  const match = termName.match(/^(Spring|Summer|Fall)\s+(\d{4})$/i);
  if (!match) return termName.replace(/\s+/g, "");
  const season = match[1].toLowerCase();
  const year = match[2];
  const codes: Record<string, string> = { spring: "SP", summer: "SU", fall: "FA" };
  return `${year}${codes[season] || season.toUpperCase()}`;
}

function termMatchesTarget(termName: string, targetTerm: string): boolean {
  // "Spring 2026 ➔" should match target "Spring 2026"
  const clean = termName.replace(/[^\w\s]/g, "").trim();
  return termToCode(clean) === termToCode(targetTerm);
}

function parseMode(modeCode: string, modeTitle: string): "in-person" | "online" | "hybrid" | "zoom" {
  const code = modeCode.trim().toUpperCase();
  const title = modeTitle.trim().toLowerCase();
  if (code === "WW" || title.includes("online")) return "online";
  if (code === "HY" || title.includes("hybrid")) return "hybrid";
  if (code === "CV" || title.includes("video") || title.includes("zoom") || title.includes("interactive")) return "zoom";
  return "in-person";
}

function parseTimes(timeStr: string): [string, string] {
  if (!timeStr || timeStr.trim() === "" || timeStr.toLowerCase().includes("tba")) {
    return ["TBA", "TBA"];
  }
  const cleaned = timeStr.replace(/\u00a0/g, " ").replace(/&nbsp;/g, " ").trim();
  if (!cleaned || cleaned.length < 3) return ["TBA", "TBA"];

  const parts = cleaned.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) return ["TBA", "TBA"];

  function norm(t: string): string {
    const result = t.replace(/\s*a\.?\s*m\.?/i, " AM").replace(/\s*p\.?\s*m\.?/i, " PM").trim();
    // Catch "0:00 AM" or empty results — these are async/online with no real time
    if (result === "0:00 AM" || result === "0:00 PM" || result === "" || result === "12:00 AM") return "TBA";
    return result;
  }
  const start = norm(parts[0]);
  const end = norm(parts[1]);
  if (start === "TBA" || end === "TBA") return ["TBA", "TBA"];
  return [start, end];
}

function parseDays($: cheerio.CheerioAPI, daysDiv: cheerio.Cheerio<cheerio.Element>): string {
  const active: string[] = [];
  daysDiv.find("span.s").each((_, el) => {
    const t = $(el).text().trim();
    if (t) active.push(t);
  });
  return active.join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AuditMap-Virginia/1.0 (educational project)",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: null;
  seats_open: null;
  seats_total: null;
}

// ---------------------------------------------------------------------------
// Step 1: Get subject URLs for a college (skip notScheduled)
// ---------------------------------------------------------------------------

async function getSubjects(slug: string): Promise<{ prefix: string; href: string }[]> {
  const html = await fetchPage(`${BASE_URL}/colleges/${slug}/courses`);
  const $ = cheerio.load(html);
  const subjects: { prefix: string; href: string }[] = [];

  $("div#main div.alphaSection ul li").each((_, li) => {
    const $li = $(li);
    if ($li.hasClass("notScheduled")) return;
    const $a = $li.find("a").first();
    const href = $a.attr("href");
    if (!href) return;
    const m = href.match(/\/courses\/([A-Z]{2,4})-/);
    if (!m) return;
    subjects.push({
      prefix: m[1],
      href: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
  });
  return subjects;
}

// ---------------------------------------------------------------------------
// Step 2: Get course page URLs from a subject page
// ---------------------------------------------------------------------------

async function getCoursePages(subjectUrl: string, prefix: string): Promise<{ prefix: string; number: string; title: string; href: string }[]> {
  const html = await fetchPage(subjectUrl);
  const $ = cheerio.load(html);
  const courses: { prefix: string; number: string; title: string; href: string }[] = [];
  const seen = new Set<string>();

  // Courses are in dl > dt > a with href like /courses/ENG111-CollegeCompositionI
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/courses\/([A-Z]{2,4})(\d{3})-([^/]+)$/);
    if (!match || match[1] !== prefix) return;
    // Skip /detail links
    if (href.includes("/detail")) return;

    const key = `${match[1]}${match[2]}`;
    if (seen.has(key)) return;
    seen.add(key);

    // Extract title from link text like "ENG 111 - College Composition I"
    let title = $(el).text().trim();
    const titleMatch = title.match(/^[A-Z]{2,4}\s+\d{3}\s*[-–—]\s*(.+)$/);
    if (titleMatch) title = titleMatch[1].trim();

    courses.push({
      prefix: match[1],
      number: match[2],
      title,
      href: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
  });

  return courses;
}

// ---------------------------------------------------------------------------
// Step 3: Scrape sections from a course page for the target term
// ---------------------------------------------------------------------------

function scrapeSections(
  html: string,
  slug: string,
  coursePrefix: string,
  courseNumber: string,
  courseTitle: string,
  targetTerm: string
): CourseSection[] {
  const $ = cheerio.load(html);
  const termCode = termToCode(targetTerm);
  const sections: CourseSection[] = [];

  // Get default credits from description
  let defaultCredits = 3;
  const creditsText = $("div.credits").first().text().trim();
  const cm = creditsText.match(/(\d+)\s*credits?/i);
  if (cm) defaultCredits = parseInt(cm[1], 10);

  $("div#schedule div.card").each((_, card) => {
    const $card = $(card);
    const termName = $card.find("div.card-header a.card-link h4").first().text().trim();
    if (!termMatchesTarget(termName, targetTerm)) return;

    $card.find("table.table tbody tr.vevent").each((_, row) => {
      const $row = $(row);
      const tds = $row.find("td");
      if (tds.length < 8) return;

      const crn = $(tds[0]).text().trim();
      if (!crn) return;

      const sectionCredits = parseInt($(tds[2]).text().trim(), 10);
      const credits = isNaN(sectionCredits) ? defaultCredits : sectionCredits;

      const daysDiv = $(tds[3]).find("div.days");
      const days = parseDays($, daysDiv);

      const timeText = $(tds[4]).find("div.times").text().trim() || $(tds[4]).text().trim();
      const [startTime, endTime] = parseTimes(timeText);

      const startDate = $(tds[5]).text().trim();
      const campus = $(tds[6]).text().trim();

      const modeSpan = $(tds[7]).find("span").first();
      const modeCode = modeSpan.text().trim();
      const modeTitle = modeSpan.attr("title") || "";

      sections.push({
        college_code: slug,
        term: termCode,
        course_prefix: coursePrefix,
        course_number: courseNumber,
        course_title: courseTitle,
        credits,
        crn,
        days,
        start_time: startTime,
        end_time: endTime,
        start_date: startDate,
        location: campus,
        campus,
        mode: parseMode(modeCode, modeTitle),
        instructor: null,
        seats_open: null,
        seats_total: null,
      });
    });
  });

  return sections;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function scrapeCollege(slug: string, targetTerm: string): Promise<CourseSection[]> {
  console.log(`\n📚 Scraping ${slug}...`);

  const subjects = await getSubjects(slug);
  console.log(`  ${subjects.length} active subjects`);
  await sleep(DELAY_MS);

  const allSections: CourseSection[] = [];
  let totalCourses = 0;
  let errorCount = 0;

  // Collect all course pages across all subjects first
  const allCoursePages: { prefix: string; number: string; title: string; href: string }[] = [];

  for (const subject of subjects) {
    try {
      const courses = await getCoursePages(subject.href, subject.prefix);
      allCoursePages.push(...courses);
    } catch (err) {
      console.error(`  ⚠ Failed to load subject ${subject.prefix}: ${(err as Error).message}`);
      errorCount++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`  ${allCoursePages.length} course pages to fetch`);

  // Fetch course pages in batches of CONCURRENCY
  for (let i = 0; i < allCoursePages.length; i += CONCURRENCY) {
    const batch = allCoursePages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (course) => {
        const html = await fetchPage(course.href);
        return { course, html };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { course, html } = result.value;
        const sections = scrapeSections(html, slug, course.prefix, course.number, course.title, targetTerm);
        allSections.push(...sections);
        totalCourses++;
        if (sections.length > 0) process.stdout.write(".");
      } else {
        errorCount++;
      }
    }

    await sleep(DELAY_MS);

    // Progress update every 50 courses
    if ((i + CONCURRENCY) % 50 < CONCURRENCY) {
      console.log(`\n  [${Math.min(i + CONCURRENCY, allCoursePages.length)}/${allCoursePages.length}] ${allSections.length} sections...`);
    }
  }

  console.log(`\n  ✅ ${slug}: ${allSections.length} sections from ${totalCourses} courses (${errorCount} errors)`);
  return allSections;
}

async function main() {
  const args = process.argv.slice(2);
  let targetSlugs = ALL_SLUGS;
  let targetTerm = DEFAULT_TERM;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--college" && args[i + 1]) {
      targetSlugs = [args[i + 1]];
      i++;
    } else if (args[i] === "--term" && args[i + 1]) {
      targetTerm = args[i + 1];
      i++;
    }
  }

  const termCode = termToCode(targetTerm);
  console.log(`🔍 Scraping ${targetSlugs.length} college(s) for: ${targetTerm} (${termCode})`);
  console.log(`   Delay: ${DELAY_MS}ms | Timeout: ${FETCH_TIMEOUT_MS}ms\n`);

  const dataDir = path.join(process.cwd(), "data", "courses");
  let totalSections = 0;

  for (const slug of targetSlugs) {
    try {
      const sections = await scrapeCollege(slug, targetTerm);
      const collegeDir = path.join(dataDir, slug);
      if (!fs.existsSync(collegeDir)) fs.mkdirSync(collegeDir, { recursive: true });

      const outFile = path.join(collegeDir, `${termCode}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
      console.log(`  💾 ${outFile} (${sections.length} sections)`);
      totalSections += sections.length;
    } catch (err) {
      console.error(`❌ ${slug}: ${(err as Error).message}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Done! ${totalSections} total sections across ${targetSlugs.length} colleges`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
