/**
 * scrape-grayson.ts — Grayson College (TX) class-section scraper.
 *
 * Grayson runs a custom "Student Planner" app at planner.grayson.edu built
 * on ASP.NET MVC. The CourseSearch page at /Planner/CourseSearch/{termId}
 * renders all sections for the given term as server-side HTML — no auth,
 * no JS required for the data itself (the filtering selects are client-side
 * only). The page response is a fully-formed HTML document with one <tr>
 * per section where each <td> carries its value in a `title="FieldName: value"`
 * attribute.
 *
 * Term discovery: the active page has a dropdown listing all available terms
 * as <a href="/Planner/CourseSearch/{termId}"> links. The scraper discovers
 * term IDs dynamically from that dropdown.
 *
 * Row schema (from title="" attributes):
 *   Course (ID)  e.g. "ACCT2301B01HY" → prefix=ACCT, number=2301, section=B01HY
 *   Name         course title
 *   Dates        "Jan 20 - Mar 12"
 *   Campus       "Main" / "Internet" / "Honors" / ...
 *   Seats        "23/30" → enrolled/total
 *   Status       "Open" / "Closed" / "Wait List"
 *   Days         "TR" / "MWF" / "N/A"
 *   Room         "CIS 104" / "Internet"
 *   Time         "11:00 AM - 12:30 PM" / "N/A"
 *   Faculty      instructor name
 *
 * Output: data/tx/courses/grayson-college/{TERM}.json
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-grayson.ts            # all available terms
 *   npx tsx scripts/tx/scrape-grayson.ts --term 2026FA  # one term
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "grayson-college";
const COLLEGE_CODE = SLUG;
const COURSES_DIR = path.join(process.cwd(), "data", "tx", "courses", SLUG);
const BASE_URL = "https://planner.grayson.edu";
const ENTRY_PATH = "/Planner/CourseSearch";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

interface TermInfo {
  id: number;
  label: string;
  fileCode: string;
}

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  status: string;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

// Derive a file code from the term label.
// e.g. "Fall 2026" → "2026FA", "Summer 2026" → "2026SU", "SumQtr 2026" → "2026SUQTR"
function termLabelToFile(label: string): string {
  const m = label.match(/^(Spring|Summer|SumQtr|Fall|FallQtr|Winter)\s+(\d{4})$/i);
  if (!m) return label.replace(/\s+/g, "").toUpperCase();
  const season = m[1].toLowerCase();
  const year = m[2];
  const code = season === "spring" ? "SP"
    : season === "summer" ? "SU"
    : season === "sumqtr" ? "SUQTR"
    : season === "fall" ? "FA"
    : season === "fallqtr" ? "FAQTR"
    : season === "winter" ? "WIN"
    : season.toUpperCase();
  return `${year}${code}`;
}

// Discover all available terms from the dropdown links on the entry page.
async function discoverTerms(): Promise<TermInfo[]> {
  const html = await fetchHtml(`${BASE_URL}${ENTRY_PATH}`);
  const $ = cheerio.load(html);
  const terms: TermInfo[] = [];
  const seen = new Set<number>();

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = $(el).text().trim();
    const m = href.match(/\/Planner\/CourseSearch\/(\d+)$/);
    if (!m) return;
    if (!/^(Spring|Summer|SumQtr|Fall|FallQtr|Winter)\s+\d{4}$/.test(label)) return;
    const id = parseInt(m[1], 10);
    if (seen.has(id)) return;
    seen.add(id);
    terms.push({ id, label, fileCode: termLabelToFile(label) });
  });

  return terms;
}

// Parse the title="FieldName: value" convention from a <td>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tdTitle(el: any, $: cheerio.CheerioAPI, prefix: string): string {
  const t = $(el).attr("title") || "";
  const m = t.match(new RegExp(`^${prefix}:\\s*(.+)$`, "i"));
  return m ? m[1].trim() : $(el).text().trim().replace(/\s+/g, " ").trim();
}

function parseSeats(seats: string): { open: number | null; total: number | null } {
  const m = seats.match(/^(\d+)\/(\d+)$/);
  if (!m) return { open: null, total: null };
  const enr = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  return { open: total - enr, total };
}

function parseTime(t: string): { start: string; end: string } {
  if (!t || /^N\/A$/i.test(t) || /^TBA$/i.test(t)) return { start: "", end: "" };
  const m = t.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (m) return { start: m[1].replace(/\s+/g, ""), end: m[2].replace(/\s+/g, "") };
  return { start: t, end: "" };
}

// "Jan 20 - Mar 12" — no year, infer from the term label
const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDateRange(dates: string, termYear: string): { startDate: string; endDate: string } {
  const m = dates.match(/^(\w{3})\s+(\d{1,2})\s*-\s*(\w{3})\s+(\d{1,2})$/i);
  if (!m) return { startDate: "", endDate: "" };
  const sm = MONTH_MAP[m[1].toLowerCase()];
  const em = MONTH_MAP[m[3].toLowerCase()];
  if (!sm || !em) return { startDate: "", endDate: "" };
  // If end month < start month, the end date is in the next year
  const sy = termYear;
  const ey = parseInt(em) < parseInt(sm) ? String(parseInt(termYear) + 1) : termYear;
  return {
    startDate: `${sy}-${sm}-${m[2].padStart(2, "0")}`,
    endDate: `${ey}-${em}-${m[4].padStart(2, "0")}`,
  };
}

// "ACCT2301B01HY" → prefix=ACCT, number=2301
function parseCourseId(id: string): { prefix: string; number: string } | null {
  const m = id.match(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)/);
  return m ? { prefix: m[1], number: m[2] } : null;
}

function inferMode(campus: string, room: string, days: string): string {
  if (/internet/i.test(campus) || /internet/i.test(room)) return "online";
  if (/hybrid/i.test(campus) || /HY$/i.test(room)) return "hybrid";
  if (!days || /^N\/A$/i.test(days)) return "online";
  return "in-person";
}

function normalizeDays(d: string): string {
  if (!d || /^N\/A$/i.test(d)) return "";
  return d.trim();
}

function parseTermYear(label: string): string {
  const m = label.match(/(\d{4})/);
  return m ? m[1] : new Date().getFullYear().toString();
}

async function scrapeOneTerm(term: TermInfo): Promise<CourseSection[]> {
  const url = `${BASE_URL}${ENTRY_PATH}/${term.id}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const termYear = parseTermYear(term.label);
  const sections: CourseSection[] = [];
  const seen = new Set<string>();

  $("tr.child").each((_, tr) => {
    const tds = $(tr).find("td").toArray();
    if (tds.length < 9) return;

    const courseId = tdTitle(tds[0], $, "Course");
    const title = tdTitle(tds[1], $, "Name");
    const dates = tdTitle(tds[2], $, "Dates");
    const campus = tdTitle(tds[3], $, "Campus");
    const seats = tdTitle(tds[4], $, "Seats");
    const status = tdTitle(tds[5], $, "Status");
    const days = tdTitle(tds[6], $, "Days");
    const room = tdTitle(tds[7], $, "Room");
    const time = tdTitle(tds[8], $, "Time");
    const faculty = tds.length > 9 ? tdTitle(tds[9], $, "Faculty") : "";

    const parsed = parseCourseId(courseId);
    if (!parsed) return;

    const { open, total } = parseSeats(seats);
    const { start, end } = parseTime(time);
    const { startDate, endDate } = parseDateRange(dates, termYear);
    const crn = courseId; // Grayson's course ID (e.g. ACCT2301B01HY) is the natural key
    if (seen.has(crn)) return;
    seen.add(crn);

    sections.push({
      college_code: COLLEGE_CODE,
      term: term.fileCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits: null,
      crn,
      days: normalizeDays(days),
      start_time: start,
      end_time: end,
      start_date: startDate,
      end_date: endDate,
      location: room === "N/A" ? "" : room,
      campus,
      mode: inferMode(campus, room, days),
      instructor: faculty || null,
      seats_open: open,
      seats_total: total,
      status,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

function parseArgs(): { onlyTerm: string | null } {
  const a = process.argv.slice(2);
  let onlyTerm: string | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--term" && a[i + 1]) onlyTerm = a[++i];
  }
  return { onlyTerm };
}

async function main() {
  const { onlyTerm } = parseArgs();
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  console.log("Grayson College scraper — discovering terms...");
  const terms = await discoverTerms();
  console.log(`→ ${terms.length} term(s): ${terms.map((t) => `${t.label} (${t.id})`).join(", ")}`);

  const targets = onlyTerm ? terms.filter((t) => t.fileCode === onlyTerm) : terms;
  if (targets.length === 0) {
    console.error(`No term matched '${onlyTerm}'.`);
    process.exit(1);
  }

  let grand = 0;
  for (const term of targets) {
    console.log(`\n=== ${term.label} → ${term.fileCode} ===`);
    const sections = await scrapeOneTerm(term);
    const out = path.join(COURSES_DIR, `${term.fileCode}.json`);
    fs.writeFileSync(out, JSON.stringify(sections, null, 2));
    console.log(`  ${sections.length} sections → ${out}`);
    grand += sections.length;
  }
  console.log(`\n✓ total: ${grand} sections`);
}

main().catch((e) => { console.error(e); process.exit(1); });
