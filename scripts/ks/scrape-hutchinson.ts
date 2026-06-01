/**
 * Hutchinson Community College — bespoke HTML scraper
 *
 * Hutchinson runs a server-rendered course-search at
 * `https://www.hutchcc.edu/courses?term_code={TERM}&page={N}` with results
 * grouped by course code inside accordion blocks. Each block holds the
 * course title, description, and a list of section sub-accordions with
 * days/times/campus/instructor.
 *
 * The orchestrator's standard Jenzabar ICS probes failed because Hutchinson
 * does not deploy the standard ICS portal — the SIS is a custom Laravel/
 * Livewire app at `dz.hutchcc.edu` (the "DragonZone"). The course-listing
 * itself is publicly served from `www.hutchcc.edu` without auth, so we
 * scrape that directly.
 *
 * Pagination: ~50 sections per page, ~30 pages per term, ~1500 sections
 * per term. Paging is via `?page=N`.
 *
 * Tracks GitHub issue #959.
 *
 * Term codes: `253S`=Summer 2026, `261S`=Fall 2026, `262S`=Spring 2027,
 * `263S`=Summer 2027 (year * 10 + season-1, with 1=Spring 2=Fall 3=Summer ...
 * actually: 25=2025-26 academic year, 1=Fall/2=Spring/3=Summer; 26=2026-27 etc.).
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-hutchinson.ts
 *   npx tsx scripts/ks/scrape-hutchinson.ts --term 261S
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "hutchinson-community-college";
const STATE = "ks";
const BASE_URL = "https://www.hutchcc.edu/courses";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: null;
  seats_total: null;
  prerequisite_text: null;
  prerequisite_courses: string[];
}

function hutchTermToStandard(code: string): string {
  // HutchCC encodes 25=2025-26 AY, then digit: 3=Summer (May–Jul), 1=Fall (Aug–Dec), 2=Spring (Jan–May), trailing S=Semester
  // So 253S = 2026 Summer (first summer of AY 25-26)... wait labels:
  //   253S → Summer 2026, 261S → Fall 2026, 262S → Spring 2027, 263S → Summer 2027
  // Decoded: 25 + 3 = Summer 2026, 26 + 1 = Fall 2026, 26 + 2 = Spring 2027, 26 + 3 = Summer 2027
  // Pattern: 2-digit AY-start-year + season(1=Fall, 2=Spring, 3=Summer) + "S"
  const m = code.match(/^(\d{2})(\d)S$/);
  if (!m) return code;
  const ayStart = 2000 + parseInt(m[1], 10);
  const season = m[2];
  if (season === "1") return `${ayStart}FA`;
  if (season === "2") return `${ayStart + 1}SP`;
  if (season === "3") return `${ayStart + 1}SU`;
  return code;
}

function parseDays(raw: string): string {
  // HutchCC writes "Days:  M T W R F" then "Times: ..." on the next li
  const m = raw.match(/Days:\s*([A-Z][A-Z\s]*?)(?=Times:|Start|End|$)/);
  if (!m) return "";
  const days = m[1].trim().replace(/\s+/g, "");
  if (days === "TBA" || days === "") return "";
  return days;
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2}\s?(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase().replace(/\s/g, " "), end: m[2].toUpperCase().replace(/\s/g, " ") };
}

function parseStartDate(raw: string): string {
  const m = raw.match(/Start Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function inferMode(campus: string, days: string): "in-person" | "online" | "hybrid" {
  const c = campus.toLowerCase();
  if (c.includes("hybrid")) return "hybrid";
  if (c === "online" || c.includes("online")) return "online";
  if (days === "" || days === "TBA") return "online";
  return "in-person";
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; cc-coursemap)" },
  });
  return await res.text();
}

async function discoverTerms(): Promise<{ code: string; label: string }[]> {
  const html = await fetchPage(BASE_URL);
  const $ = cheerio.load(html);
  const terms: { code: string; label: string }[] = [];
  $('select[name="term_code"] option').each((_, el) => {
    const val = $(el).attr("value") || "";
    const label = $(el).text().trim();
    if (/^\d{3}S$/.test(val)) terms.push({ code: val, label });
  });
  return terms;
}

async function discoverPageCount(termCode: string): Promise<number> {
  const html = await fetchPage(`${BASE_URL}?term_code=${termCode}`);
  const matches = html.match(/page=(\d+)/g) || [];
  const pages = matches.map((m) => parseInt(m.slice(5), 10)).filter((n) => !Number.isNaN(n));
  return pages.length > 0 ? Math.max(...pages) : 1;
}

function parseCourseAccordion($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI, stdTerm: string): CourseSection[] {
  const titleRaw = $el.find("a.accordian-program-title").first().text().trim();
  // e.g. "Basic Concepts for Allied Health Studies - BI100"
  const titleMatch = titleRaw.match(/^(.*?)\s+-\s+([A-Z]{2,4})(\d{3}[A-Z]?)$/);
  if (!titleMatch) return [];
  const [, courseTitle, prefix, number] = titleMatch;

  const sections: CourseSection[] = [];
  $el.find("li").each((_, li) => {
    const $li = $(li);
    const headerSpan = $li.find("a.accordion-section-title > span").first();
    if (!headerSpan.length) return;
    const headerText = headerSpan.text().replace(/\s+/g, " ").trim();
    // e.g. "BI100 002261S McPherson"
    const m = headerText.match(/^([A-Z]{2,4}\d{3}[A-Z]?)\s+(\S+)\s+(.+)$/);
    if (!m) return;
    const [, , sectionId, campusGuess] = m;

    // WHEN block
    const whenList = $li.find('ul.uk-list:has(li:contains("WHEN"))').first();
    let days = "";
    let start_time = "";
    let end_time = "";
    let start_date = "";
    if (whenList.length) {
      const whenText = whenList.text();
      days = parseDays(whenText);
      ({ start: start_time, end: end_time } = parseTime(whenText));
      start_date = parseStartDate(whenText);
    }

    // WHERE block
    const whereList = $li.find('ul.uk-list:has(li:contains("WHERE"))').first();
    let campus = campusGuess;
    let building = "";
    let room = "";
    if (whereList.length) {
      const text = whereList.text();
      const campusM = text.match(/Campus:\s*([^\n]+?)(?:Building:|Room:|$)/);
      const buildingM = text.match(/Building:\s*([^\n]+?)(?:Room:|$)/);
      const roomM = text.match(/Room:\s*([^\n]+?)$/);
      if (campusM) campus = campusM[1].trim();
      if (buildingM) building = buildingM[1].trim();
      if (roomM) room = roomM[1].trim();
    }
    const location = [building, room].filter(Boolean).join(" ");

    // INSTRUCTOR block
    const instList = $li.find('ul.uk-list:has(li:contains("INSTRUCTOR"))').first();
    let instructor: string | null = null;
    if (instList.length) {
      const lis = instList.find("li");
      if (lis.length >= 2) instructor = $(lis[1]).text().trim() || null;
    }

    // Credit Hours — search descendants of the parent course accordion
    const creditMatch = $li.closest("li.uk-list").text().match(/Credit Hours:[^\d]*([\d.]+)/);
    const credits = creditMatch ? parseFloat(creditMatch[1]) : 0;

    sections.push({
      college_code: SLUG,
      term: stdTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: courseTitle.trim(),
      credits,
      crn: sectionId,
      days,
      start_time,
      end_time,
      start_date,
      location,
      campus,
      mode: inferMode(campus, days),
      instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

async function scrapeTermPage(termCode: string, page: number): Promise<CourseSection[]> {
  const url = `${BASE_URL}?term_code=${termCode}${page > 1 ? `&page=${page}` : ""}`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const stdTerm = hutchTermToStandard(termCode);
  const sections: CourseSection[] = [];

  $("#program-accordion > li").each((_, el) => {
    sections.push(...parseCourseAccordion($(el), $, stdTerm));
  });
  return sections;
}

async function scrapeTerm(termCode: string): Promise<CourseSection[]> {
  const stdTerm = hutchTermToStandard(termCode);
  const pageCount = await discoverPageCount(termCode);
  console.log(`    ${termCode} → ${stdTerm}: ${pageCount} pages to fetch`);
  const all: CourseSection[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const pageSections = await scrapeTermPage(termCode, p);
    all.push(...pageSections);
    if (p % 5 === 0 || p === pageCount) {
      console.log(`      page ${p}/${pageCount}: total ${all.length}`);
    }
  }
  return all;
}

function isCurrentOrUpcoming(stdTerm: string, refYear: number): boolean {
  const m = stdTerm.match(/^(\d{4})(SP|SU|FA)$/);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const season = m[2];
  if (year < refYear) return false;
  if (year > refYear + 1) return false;
  if (year === refYear && season === "SP") return false;
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("🐉 Hutchinson Community College scraper");
  console.log(`   Source: ${BASE_URL}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const allTerms = await discoverTerms();
  console.log(`   Found ${allTerms.length} terms: ${allTerms.map((t) => `${t.code} (${t.label})`).join(", ")}`);

  const refYear = new Date().getUTCFullYear();
  const targetTerms = termFilter
    ? allTerms.filter((t) => t.code === termFilter)
    : allTerms.filter((t) => isCurrentOrUpcoming(hutchTermToStandard(t.code), refYear));

  console.log(`   Target: ${targetTerms.map((t) => `${t.code} (${t.label})`).join(", ") || "(none)"}`);

  let grandTotal = 0;
  for (const { code } of targetTerms) {
    const sections = await scrapeTerm(code);
    if (sections.length === 0) {
      console.log(`    → 0 sections (${code})`);
      continue;
    }
    const stdTerm = hutchTermToStandard(code);
    const outPath = path.join(COURSES_DIR, `${stdTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    ✓ ${stdTerm}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ Hutchinson scraper failed:", err);
  process.exit(1);
});
