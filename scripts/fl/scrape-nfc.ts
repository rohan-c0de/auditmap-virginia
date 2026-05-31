/**
 * scrape-nfc.ts — North Florida College class search
 *
 * NFC publishes the entire schedule as a single HTML table via an
 * Oracle APEX report at
 *   https://infonetwork.nfc.edu/apex/r/nfcapi/nfc_schedule/course-schedule
 *
 * No auth, no pagination — every active section across every term
 * lives in one ~600KB HTML response. Columns:
 *   Term | Department | Course | CRN | Sect | Course Title | Instructor
 *   | Modality | Days | Time | Location | Cr Hrs | Minimester | Start | End
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-nfc.ts
 *   npx tsx scripts/fl/scrape-nfc.ts --term "Fall 2026"
 */
import * as fs from "fs";
import * as path from "path";

const URL = "https://infonetwork.nfc.edu/apex/r/nfcapi/nfc_schedule/course-schedule";
const COLLEGE_SLUG = "nfc";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026":   "2026FA",
  "Spring 2027": "2027SP",
  "Summer 2027": "2027SU",
};

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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#x2F;/g, "/")
    .replace(/&#x20;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normDays(raw: string): string {
  const r = raw.trim().toUpperCase();
  if (r === "ONLINE" || r === "TBA" || r === "") return "";
  const map: Record<string, string> = { M: "Mo", T: "Tu", W: "We", R: "Th", F: "Fr", S: "Sa", U: "Su" };
  return r.split("").map(c => map[c] || "").join("");
}

function normTime(raw: string): { start: string; end: string } {
  const r = raw.trim();
  if (r === "ONLINE" || r === "TBA" || !r) return { start: "", end: "" };
  const m = r.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].replace(/\s/g, "").toUpperCase(), end: m[2].replace(/\s/g, "").toUpperCase() };
}

function parseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function detectTermFile(termRaw: string): string | null {
  const term = termRaw.trim();
  return TERM_FILE_CODES[term] || null;
}

async function fetchSchedule(): Promise<string> {
  const res = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept": "text/html",
      "Accept-Encoding": "identity",
    },
  });
  if (!res.ok) throw new Error(`GET ${URL} -> ${res.status}`);
  return res.text();
}

function parseTable(html: string): CourseSection[] {
  const sections: CourseSection[] = [];
  // Find the Course Schedule report table (it's the first one with these headers)
  const tableMatch = html.match(/<table[^>]*aria-label="Course Schedule"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    console.warn("Could not find Course Schedule table");
    return sections;
  }
  const tableHtml = tableMatch[1];

  // Each row: extract by headers attribute to be robust to column order
  for (const rowMatch of tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const rowHtml = rowMatch[1];
    if (!rowHtml.includes('class="t-Report-cell"')) continue;

    const get = (header: string): string => {
      const cellMatch = rowHtml.match(new RegExp(`<td[^>]*headers="${header}"[^>]*>([\\s\\S]*?)</td>`));
      if (!cellMatch) return "";
      return decodeHtml(cellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    };

    const term = get("TERM");
    const dept = get("DEPARTMENT");
    const courseRaw = get("COURSE");
    const crn = get("CRN");
    const sect = get("SECT");
    const title = get("COURSE_TITLE");
    const instructor = get("INSTRUCTOR");
    const modality = get("MODALITY");
    const daysRaw = get("DAYS");
    const timeRaw = get("TIME");
    const location = get("LOCATION");
    const credits = get("CR_HRS");
    const startDate = parseDate(get("START_DATE"));

    if (!term || !courseRaw || !crn) continue;
    const fileTermCode = detectTermFile(term);
    if (!fileTermCode) continue;  // skip terms we don't know

    // courseRaw is like "EEX 1010" — split into prefix + number
    const courseMatch = courseRaw.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
    if (!courseMatch) continue;
    const prefix = courseMatch[1];
    const number = courseMatch[2];

    const isOnline = /online/i.test(modality) || /online/i.test(daysRaw);
    const isHybrid = /hybrid/i.test(modality);
    const { start, end } = normTime(timeRaw);

    const inst = instructor && !/tba|staff/i.test(instructor.trim()) ? instructor.trim() : null;

    sections.push({
      college_code: COLLEGE_SLUG,
      term: fileTermCode,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: parseInt(credits, 10) || 3,
      crn: `${crn}-${sect}`,
      days: normDays(daysRaw),
      start_time: start,
      end_time: end,
      start_date: startDate,
      location: isOnline ? "" : location,
      campus: dept || "",
      mode: isOnline ? "online" : isHybrid ? "hybrid" : "in-person",
      instructor: inst,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termFilter = args.find(a => a === "--term") ? args[args.indexOf("--term") + 1] : null;

  console.log("\nNorth Florida College — full schedule pull");
  const html = await fetchSchedule();
  console.log(`  fetched ${html.length} bytes`);

  const all = parseTable(html);
  console.log(`  parsed ${all.length} sections`);

  // Group by term and write per-term files
  const byTerm: Record<string, CourseSection[]> = {};
  for (const s of all) {
    if (termFilter) {
      const wantTermFile = TERM_FILE_CODES[termFilter];
      if (s.term !== wantTermFile) continue;
    }
    (byTerm[s.term] ||= []).push(s);
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const [termFile, sections] of Object.entries(byTerm)) {
    const p = path.join(DATA_DIR, `${termFile}.json`);
    fs.writeFileSync(p, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${termFile}: ${sections.length} sections → ${path.relative(process.cwd(), p)}`);
  }
  console.log(`\nDone! ${all.length} sections across ${Object.keys(byTerm).length} term(s)\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
