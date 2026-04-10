/**
 * scrape-mccs.ts
 *
 * Scrapes course section data from all 7 Maine Community College System (MCCS)
 * colleges. Each college has a WordPress site with jQuery DataTables that renders
 * course data client-side, so Playwright is required.
 *
 * Key discovery: the year-term-chooser dropdown values use academic-year codes
 * like "2627_FA" for Fall 2026 (meaning the 2026–2027 academic year). The URL
 * params must use this format: ?courseyear=2627&courseterm=FA
 *
 * College-specific notes:
 *   CMCC  — #course-results-api, 7 cols, course codes like "ACC120CM"
 *   NMCC  — #course-results, 7 cols, codes like "ACC114NM"
 *   EMCC  — #results, 6 cols, codes like "ALH102"
 *   SMCC  — #json-results, 6 cols, codes like "ACCT 105" (has space)
 *   WCCC  — #course-results-api, 11 cols (includes capacity + description)
 *   YCCC  — Per-semester WordPress pages (16-week, 12-week, 7-week I & II),
 *           5 cols, codes like "ACC 111 01" (prefix number section in one cell)
 *   KVCC  — PDF only (not scraped here)
 *
 * Usage:
 *   npx tsx scripts/me/scrape-mccs.ts
 *   npx tsx scripts/me/scrape-mccs.ts --college=cmcc
 *   npx tsx scripts/me/scrape-mccs.ts --term=Spring --year=2026
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convert calendar year + term to the academic-year code MCCS uses.
 *  Fall 2026 → courseyear=2627, courseterm=FA
 *  Spring 2026 → courseyear=2526, courseterm=SP
 *  Summer 2026 → courseyear=2526, courseterm=SU */
function toMccsParams(year: number, term: string): { courseyear: string; courseterm: string } {
  const t = term.toLowerCase();
  if (t.includes("fall")) {
    const y2 = String(year + 1).slice(2);
    return { courseyear: `${year % 100}${y2}`, courseterm: "FA" };
  }
  // Spring and Summer belong to the prior academic year
  const y1 = String(year - 1).slice(2);
  const y2 = String(year).slice(2);
  if (t.includes("spring")) return { courseyear: `${y1}${y2}`, courseterm: "SP" };
  if (t.includes("summer")) return { courseyear: `${y1}${y2}`, courseterm: "SU" };
  return { courseyear: `${year % 100}${String(year + 1).slice(2)}`, courseterm: "FA" };
}

function termToCode(term: string, year: number): string {
  const t = term.toLowerCase();
  if (t.includes("fall")) return `${year}FA`;
  if (t.includes("spring")) return `${year}SP`;
  if (t.includes("summer")) return `${year}SU`;
  return `${year}XX`;
}

/** Parse MCCS course codes.
 *  Formats:
 *    "ACC120CM"    → prefix=ACC, number=120 (CM is campus suffix)
 *    "ALH102"      → prefix=ALH, number=102
 *    "ACCT 105"    → prefix=ACCT, number=105
 *    "ACC 111 01"  → prefix=ACC, number=111, section=01
 */
function parseMccsCourseCode(
  raw: string
): { prefix: string; number: string; section?: string } | null {
  const s = raw.trim();
  if (!s) return null;

  // "ACC 111 01" — space-separated with section
  const m3 = s.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(\d{1,3})$/i);
  if (m3) return { prefix: m3[1].toUpperCase(), number: m3[2], section: m3[3] };

  // "ACCT 105" — space-separated
  const m2 = s.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/i);
  if (m2) return { prefix: m2[1].toUpperCase(), number: m2[2] };

  // "ACC120CM" or "ALH102" — letters+digits+optional 2-letter campus code
  const m1 = s.match(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)(?:[A-Z]{2})?$/i);
  if (m1) return { prefix: m1[1].toUpperCase(), number: m1[2] };

  return null;
}

function normalizeDate(d: string): string {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // MM-DD-YYYY or MM/DD/YYYY
  const m1 = d.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2, "0")}-${m1[2].padStart(2, "0")}`;
  // "Aug 24, 2026"
  const ts = Date.parse(d);
  if (!isNaN(ts)) {
    const dt = new Date(ts);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return "";
}

function parseDates(raw: string): string {
  if (!raw) return "";
  // "08-31-2026 - 12-18-2026" or "2026-08-31 - 2026-12-18" or "2026-08-24 / 2026-12-12"
  // or "Aug 24, 2026 - Dec 12, 2026"
  const parts = raw.split(/\s*[-–\/]\s*/);
  return normalizeDate(parts[0]?.trim() || "");
}

function parseSchedule(raw: string): { days: string; startTime: string; endTime: string; location: string } {
  const result = { days: "", startTime: "", endTime: "", location: "" };
  if (!raw) return result;

  // Format: "Monday, Wednesday: 9:30 AM - 10:55 AM in 215 Computer Lab (LaPoint Center)"
  // or: "Tuesday: 9:30 AM - 10:45 AMThursday: 9:30 AM - 10:45 AM" (YCCC, no space between entries)
  // or: "Monday: 09:00:00 AM - 05:00:00 PM in Outdoor Leadership Classroom"

  // Extract location (after " in ")
  const locMatch = raw.match(/\s+in\s+(.+?)(?:\s*$|\s*at\s+)/i);
  if (locMatch) result.location = locMatch[1].trim();

  // Also check for "at Campus" suffix
  const atMatch = raw.match(/\s+at\s+(.+?)$/i);
  if (atMatch && !result.location) result.location = atMatch[1].trim();

  // Extract days — find day names before the colon
  const dayNames: string[] = [];
  const dayPattern =
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
  let dm;
  while ((dm = dayPattern.exec(raw)) !== null) {
    dayNames.push(dm[1]);
  }
  result.days = normalizeDayNames(dayNames);

  // Extract times
  const timeMatch = raw.match(
    /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i
  );
  if (timeMatch) {
    result.startTime = normalizeTime(timeMatch[1]);
    result.endTime = normalizeTime(timeMatch[2]);
  }

  return result;
}

function normalizeDayNames(names: string[]): string {
  const map: Record<string, string> = {
    monday: "M", mon: "M",
    tuesday: "Tu", tue: "Tu",
    wednesday: "W", wed: "W",
    thursday: "Th", thu: "Th",
    friday: "F", fri: "F",
    saturday: "Sa", sat: "Sa",
    sunday: "Su", sun: "Su",
  };
  const seen = new Set<string>();
  const result: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    const abbr = map[key];
    if (abbr && !seen.has(abbr)) {
      seen.add(abbr);
      result.push(abbr);
    }
  }
  return result.join(" ");
}

function normalizeTime(raw: string): string {
  if (!raw) return "";
  // "9:30 AM" or "09:00:00 AM" → "09:30 am"
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!m) return raw.trim();
  return `${m[1].padStart(2, "0")}:${m[2]} ${m[3].toLowerCase()}`;
}

function determineMode(raw: string, hasSchedule = true): CourseMode {
  if (!raw) return hasSchedule ? "in-person" : "online";
  const lower = raw.toLowerCase();
  if (lower.includes("hybrid") || lower.includes("hyflex")) return "hybrid";
  if (lower.includes("online")) return "online";
  if (lower.includes("remote") || lower.includes("zoom") || lower.includes("virtual")) return "zoom";
  // If mode column only has course-type info (Lecture, Lab, Clinical) and no schedule,
  // the section is likely online
  if (!hasSchedule && /^(lecture|lab|clinical|lecture and lab|lecture and shop)$/i.test(raw.trim())) {
    return "online";
  }
  return "in-person";
}

const CAMPUS_NAMES: Record<string, string> = {
  cmcc: "Auburn",
  nmcc: "Presque Isle",
  emcc: "Bangor",
  smcc: "South Portland",
  wccc: "Calais",
  yccc: "Wells",
  kvcc: "Fairfield",
};

// ---------------------------------------------------------------------------
// Per-college extractors
// ---------------------------------------------------------------------------

/** Generic: load page, show all rows in DataTables, extract raw cell text */
async function loadAllDataTableRows(
  page: Page,
  url: string,
  tableSelector: string,
  waitMs = 10000
): Promise<string[][]> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(waitMs);

  // Click "Show All" in DataTables length menu
  await page.evaluate((sel) => {
    const table = document.querySelector(sel);
    if (!table) return;
    // Find the length menu associated with this table
    const wrapper = table.closest(".dataTables_wrapper");
    const lengthSelect = wrapper?.querySelector(
      ".dataTables_length select"
    ) as HTMLSelectElement | null;
    if (lengthSelect) {
      lengthSelect.value = "-1";
      lengthSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, tableSelector);

  await sleep(2000);

  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    if (!table) return [];
    const rows = table.querySelectorAll("tbody tr");
    return Array.from(rows).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map(
        (td) => td.textContent?.trim() || ""
      )
    );
  }, tableSelector);
}

/** CMCC — 7 cols: Course Number | Section | Course Name | Schedule | Start/End Date | Course Type | Delivery Method
 *  Course codes: "ACC120CM" (prefix+number+campus 2-char suffix) */
async function scrapeCmcc(page: Page, year: number, term: string, termCode: string): Promise<CourseSection[]> {
  const { courseyear, courseterm } = toMccsParams(year, term);
  const url = `https://www.cmcc.edu/academics/programs/course-listing/?courseyear=${courseyear}&courseterm=${courseterm}`;
  const rows = await loadAllDataTableRows(page, url, "#course-results-api");
  return rowsToSections(rows, "cmcc", termCode, {
    courseNumber: 0, section: 1, courseName: 2, schedule: 3, dates: 4, courseType: 5, deliveryMethod: 6,
  });
}

/** NMCC — 7 cols: Course Number | Section Number | Course Name | Credit Hours | Days, Time and Location | Start/End Date | Delivery Method */
async function scrapeNmcc(page: Page, year: number, term: string, termCode: string): Promise<CourseSection[]> {
  const { courseyear, courseterm } = toMccsParams(year, term);
  const termPath = term.toLowerCase().includes("spring") ? "spring-courses" : term.toLowerCase().includes("summer") ? "summer-courses" : "fall-courses";
  const url = `https://www.nmcc.edu/academics/programs/course-schedule/${termPath}/?courseyear=${courseyear}&courseterm=${courseterm}`;
  const rows = await loadAllDataTableRows(page, url, "#course-results");
  return rowsToSections(rows, "nmcc", termCode, {
    courseNumber: 0, section: 1, courseName: 2, credits: 3, schedule: 4, dates: 5, deliveryMethod: 6,
  });
}

/** EMCC — 6 cols: Course Number | Section | Course Name | Start/End Date | Instructor | Meeting Type */
async function scrapeEmcc(page: Page, year: number, term: string, termCode: string): Promise<CourseSection[]> {
  const { courseyear, courseterm } = toMccsParams(year, term);
  const url = `https://www.emcc.edu/academics/programs/courses/?courseyear=${courseyear}&courseterm=${courseterm}`;
  const rows = await loadAllDataTableRows(page, url, "#results");
  return rowsToSections(rows, "emcc", termCode, {
    courseNumber: 0, section: 1, courseName: 2, dates: 3, instructor: 4, deliveryMethod: 5,
  });
}

/** SMCC — 6 cols: Course Number | Section Number | Course Name | Start/End Date | Schedule | Delivery Method */
async function scrapeSMCC(page: Page, year: number, term: string, termCode: string): Promise<CourseSection[]> {
  const { courseyear, courseterm } = toMccsParams(year, term);
  const url = `https://www.smccme.edu/course-schedule/?courseyear=${courseyear}&courseterm=${courseterm}`;
  const rows = await loadAllDataTableRows(page, url, "#json-results");
  return rowsToSections(rows, "smcc", termCode, {
    courseNumber: 0, section: 1, courseName: 2, dates: 3, schedule: 4, deliveryMethod: 5,
  });
}

/** WCCC — 11 cols: Course Number | Section | Course Name | Start/End Date | Credit Hours |
 *  Schedule | Instructor | Maximum Capacity | Seats Filled | Type | Course Description */
async function scrapeWCCC(page: Page, year: number, term: string, termCode: string): Promise<CourseSection[]> {
  const { courseyear, courseterm } = toMccsParams(year, term);
  const url = `https://wccc.me.edu/academics/programs/course-schedule-2/?courseyear=${courseyear}&courseterm=${courseterm}`;
  const rows = await loadAllDataTableRows(page, url, "#course-results-api");
  return rowsToSections(rows, "wccc", termCode, {
    courseNumber: 0, section: 1, courseName: 2, dates: 3, credits: 4,
    schedule: 5, instructor: 6, maxCapacity: 7, seatsFilled: 8, deliveryMethod: 9,
  });
}

/** YCCC — 5 cols: Course Number (includes section) | Name | Start/End Date | Schedule | Delivery Method
 *  Multiple pages per term (16-week, 12-week, 7-week I, 7-week II) */
async function scrapeYCCC(page: Page, year: number, term: string, termCode: string): Promise<CourseSection[]> {
  const t = term.toLowerCase();
  let termSlug: string;
  if (t.includes("fall")) termSlug = `fall-${year}`;
  else if (t.includes("spring")) termSlug = `spring-${year}`;
  else termSlug = `summer-${year}`;

  const suffixes = [
    `${termSlug}-16-week-semester`,
    `${termSlug}-12-week-term`,
    `${termSlug}-7-week-term-i`,
    `${termSlug}-7-week-term-ii`,
  ];

  const all: CourseSection[] = [];
  for (const suffix of suffixes) {
    const url = `https://www.yccc.edu/explore/applying-to-yccc/course-schedules/${suffix}/`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await sleep(5000);

      const rows = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table) return [];
        return Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() || "")
        );
      });

      if (rows.length === 0) continue;

      // YCCC: col 0 = "ACC 111 01" (prefix number section)
      for (const row of rows) {
        if (row.length < 5) continue;
        const parsed = parseMccsCourseCode(row[0]);
        if (!parsed) continue;

        const sched = parseSchedule(row[3]);
        const mode = determineMode(row[4]);
        const startDate = parseDates(row[2]);

        all.push({
          college_code: "yccc",
          term: termCode,
          course_prefix: parsed.prefix,
          course_number: parsed.number,
          course_title: row[1] || "",
          credits: 0,
          crn: `${parsed.prefix}${parsed.number}-${parsed.section || "01"}`,
          days: sched.days,
          start_time: sched.startTime,
          end_time: sched.endTime,
          start_date: startDate,
          location: sched.location,
          campus: CAMPUS_NAMES.yccc,
          mode,
          instructor: null,
          seats_open: null,
          seats_total: null,
          prerequisite_text: null,
          prerequisite_courses: [],
        });
      }
      console.log(`    yccc/${suffix}: ${rows.length} rows`);
    } catch (err) {
      console.log(`    yccc/${suffix}: FAILED — ${err}`);
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Generic row→section converter
// ---------------------------------------------------------------------------

interface ColumnMap {
  courseNumber: number;
  section?: number;
  courseName: number;
  credits?: number;
  schedule?: number;
  dates?: number;
  instructor?: number;
  deliveryMethod?: number;
  courseType?: number;
  maxCapacity?: number;
  seatsFilled?: number;
}

function rowsToSections(
  rows: string[][],
  collegeCode: string,
  termCode: string,
  cols: ColumnMap
): CourseSection[] {
  const sections: CourseSection[] = [];

  for (const row of rows) {
    if (row.length < 3) continue;
    const courseRaw = row[cols.courseNumber] || "";
    if (!courseRaw || courseRaw.includes("No data") || courseRaw.includes("No records")) continue;

    const parsed = parseMccsCourseCode(courseRaw);
    if (!parsed) continue;

    const title = row[cols.courseName] || "";
    if (!title) continue;

    const sectionNum = parsed.section || (cols.section != null ? row[cols.section] : "") || "01";
    const credits = cols.credits != null ? parseFloat(row[cols.credits]) || 0 : 0;

    const schedRaw = cols.schedule != null ? row[cols.schedule] : "";
    const sched = parseSchedule(schedRaw);

    const datesRaw = cols.dates != null ? row[cols.dates] : "";
    const startDate = parseDates(datesRaw);

    const instructorRaw = cols.instructor != null ? row[cols.instructor] : "";
    const instructor =
      instructorRaw && instructorRaw !== "TBA" && !instructorRaw.includes("TBA,") && instructorRaw !== "Staff"
        ? instructorRaw
        : null;

    const modeRaw = cols.deliveryMethod != null ? row[cols.deliveryMethod] : "";
    const courseTypeRaw = cols.courseType != null ? row[cols.courseType] : "";
    const hasScheduleData = !!(sched.days || sched.startTime);
    const mode = determineMode(modeRaw || courseTypeRaw, hasScheduleData);

    let seatsOpen: number | null = null;
    let seatsTotal: number | null = null;
    if (cols.maxCapacity != null) {
      const total = parseInt(row[cols.maxCapacity]) || null;
      const filled = cols.seatsFilled != null ? parseInt(row[cols.seatsFilled]) || 0 : 0;
      seatsTotal = total;
      seatsOpen = total != null ? Math.max(0, total - filled) : null;
    }

    sections.push({
      college_code: collegeCode,
      term: termCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits,
      crn: `${parsed.prefix}${parsed.number}-${sectionNum}`,
      days: sched.days,
      start_time: sched.startTime,
      end_time: sched.endTime,
      start_date: startDate,
      location: sched.location,
      campus: CAMPUS_NAMES[collegeCode] || "",
      mode,
      instructor,
      seats_open: seatsOpen,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface CollegeAdapter {
  id: string;
  name: string;
  fn: (page: Page, year: number, term: string, termCode: string) => Promise<CourseSection[]>;
}

const ADAPTERS: CollegeAdapter[] = [
  { id: "cmcc", name: "Central Maine CC", fn: scrapeCmcc },
  { id: "nmcc", name: "Northern Maine CC", fn: scrapeNmcc },
  { id: "emcc", name: "Eastern Maine CC", fn: scrapeEmcc },
  { id: "smcc", name: "Southern Maine CC", fn: scrapeSMCC },
  { id: "wccc", name: "Washington County CC", fn: scrapeWCCC },
  { id: "yccc", name: "York County CC", fn: scrapeYCCC },
  // KVCC is PDF-only — no web-based course schedule to scrape
];

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1];
  const term = args.find((a) => a.startsWith("--term="))?.split("=")[1] || "Fall";
  const year = parseInt(args.find((a) => a.startsWith("--year="))?.split("=")[1] || "2026");

  const targets = collegeFilter
    ? ADAPTERS.filter((a) => a.id === collegeFilter)
    : ADAPTERS;

  const termCode = termToCode(term, year);
  console.log(`\nMCCS Course Scraper — ${term} ${year} (${termCode}) — ${targets.length} colleges\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const allSections: CourseSection[] = [];

  for (const adapter of targets) {
    console.log(`  ${adapter.id} (${adapter.name})...`);
    try {
      const sections = await adapter.fn(page, year, term, termCode);
      allSections.push(...sections);
      console.log(`  ✓ ${adapter.id}: ${sections.length} sections`);
    } catch (err) {
      console.error(`  ✗ ${adapter.id}: Error — ${err}`);
    }
  }

  await browser.close();

  // Group by college and write output
  const byCollege = new Map<string, CourseSection[]>();
  for (const s of allSections) {
    const arr = byCollege.get(s.college_code) || [];
    arr.push(s);
    byCollege.set(s.college_code, arr);
  }

  for (const [collegeCode, sections] of byCollege) {
    const outDir = path.join("data", "me", "courses", collegeCode);
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${termCode}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
    console.log(`\n  Wrote ${sections.length} sections → ${outFile}`);
  }

  // Summary
  console.log("\n--- Summary ---");
  for (const adapter of targets) {
    const count = byCollege.get(adapter.id)?.length || 0;
    const status = count > 0 ? `${count} sections` : "NO DATA";
    console.log(`  ${adapter.id.padEnd(6)} ${adapter.name.padEnd(30)} ${status}`);
  }
  console.log(`\n  Total: ${allSections.length} sections across ${byCollege.size} colleges`);
  if (!byCollege.has("kvcc")) {
    console.log("  Note: KVCC (Kennebec Valley CC) is PDF-only and not scraped here.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
