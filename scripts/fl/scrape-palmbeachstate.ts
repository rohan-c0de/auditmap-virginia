/**
 * scrape-palmbeachstate.ts — Palm Beach State College course search
 *
 * PBSC uses a custom ASP.NET WebForms course-search app at
 *   https://studentcoursesearch.palmbeachstate.edu/Default.aspx
 *
 * Strategy: GET the page to obtain a fresh __VIEWSTATE session token,
 * then POST once per (term, subject). The term listBox uses wildcard
 * values like "Fall%2026%" to select all Fall 2026 sessions at once.
 *
 * Table structure per row (course_section_id in the first cell link):
 *   0: <a href="CourseDetail.aspx?course_section_id=NNNNN">Select</a>
 *   1: Term name (e.g. "2026 Fall Express A")
 *   2: Materials icon (skip)
 *   3: "PREFIX NNNN-SS - Title" (e.g. "MAC 1105-101 - College Algebra")
 *   4: Location / building+room
 *   5: Dates nested table (or empty for online) — "M/D/Y - M/D/Y"
 *   6: Days (e.g. "Tues/Thurs") — or Delivery Mode for online sections
 *   7: Time range — or Credits for online sections
 *   8+: credits, instructor, status (variable depending on row type)
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-palmbeachstate.ts
 *   npx tsx scripts/fl/scrape-palmbeachstate.ts --term "Fall 2026"
 *   npx tsx scripts/fl/scrape-palmbeachstate.ts --term "Fall 2026" --subject MAC
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://studentcoursesearch.palmbeachstate.edu/Default.aspx";
const COLLEGE_SLUG = "palmbeachstate";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

// listBoxTerm values — the % wildcard matches all sessions for the term
const TERM_MAP: Record<string, { value: string; file: string }> = {
  "Summer 2026": { value: "Summer%2026%", file: "2026SU" },
  "Fall 2026":   { value: "Fall%2026%",   file: "2026FA" },
};

const PBSC_SUBJECTS = [
  "ACG","ACR","AER","AMH","AML","ANT","APA","ARC","ARH","ART","AST","AVO",
  "BAN","BCA","BCN","BCT","BCV","BOT","BSC","BUL",
  "CAI","CAP","CCJ","CEN","CET","CGS","CHD","CHM","CIS","CJB","CJE","CJJ","CJK","CJL","CLP","CNT","COP","COS","CPO","CRW","CSP","CTS",
  "DAA","DEA","DEH","DEP","DES","DIG","DIM","DSC",
  "EAP","ECO","EDF","EDG","EDP","EEC","EET","EEV","EEX","EGN","EME","EMS","ENC","ENL","ENT","EPI","ESC","ETD","ETI","ETM","ETP","ETS","EVR","EVS",
  "FFP","FIL","FIN","FOS","FRE","FSS",
  "GCO","GEA","GEB","GER","GEY","GLY","GRA",
  "HCP","HEV","HFT","HIM","HOS","HSA","HSC","HUN","HUS",
  "IDC","IDH","IND","INR","ISM",
  "JST","LDE","LIT",
  "MAC","MAD","MAN","MAP","MAR","MAS","MAT","MCB","MEA","MGF","MKA","MMC","MNA","MSL","MSS","MTB","MTE","MUH","MUL","MUN","MUS",
  "NUR","OCE","ORI","OST","OTH",
  "PAS","PET","PGY","PHI","PHT","PHY","PLA","PMT","POS","PRN","PSY",
  "RAD","RCP","REL","RET","RTE","RTV",
  "SCE","SLS","SON","SPC","SPN","SSE","STA","STS","SYG",
  "THE","TSM","VIC","WOH",
];

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

function parseArgs() {
  const args = process.argv.slice(2);
  let termArg = "";
  let subjectFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
    else if (args[i] === "--subject" && args[i + 1]) { subjectFilter = args[i + 1].toUpperCase(); i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return { terms: termArg.split(",").map(t => t.trim()).filter(Boolean), subjectFilter };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseDays(raw: string): string {
  const map: Record<string, string> = {
    mon: "Mo", tue: "Tu", wed: "We", thu: "Th", fri: "Fr", sat: "Sa", sun: "Su",
    monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su",
  };
  return raw.toLowerCase().split(/[/,\s]+/).map(d => map[d.trim()] || "").join("");
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.trim().match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (m) return { start: m[1].replace(" ", ""), end: m[2].replace(" ", "") };
  return { start: "", end: "" };
}

function parseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseRow(cells: string[], crn: string, fileTermCode: string): CourseSection | null {
  if (cells.length < 4 || !crn) return null;

  // Cell 3: "PREFIX NNNN-SS - Title" or "PREFIX NNNN - Title"
  const titleCell = cells[3] || "";
  const courseMatch = titleCell.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)(?:-\S+)?\s*[-–]\s*(.+)$/);
  if (!courseMatch) return null;
  const prefix = courseMatch[1];
  const number = courseMatch[2];
  const title = courseMatch[3].trim();

  const location = stripTags(cells[4] || "");
  const datesRaw = stripTags(cells[5] || "");
  const daysRaw = stripTags(cells[6] || "");
  const timesRaw = stripTags(cells[7] || "");
  const creditsRaw = stripTags(cells[8] || cells[7] || "3");
  const instructorRaw = stripTags(cells[9] || cells[8] || "");
  const statusRaw = stripTags(cells[10] || cells[9] || "");

  // Determine mode: if daysRaw is a delivery-mode string (Online/Hybrid), shift columns
  const isOnline = /online|web/i.test(daysRaw) || /online/i.test(location);
  const isHybrid = /hybrid/i.test(daysRaw);
  let mode = "in-person";
  if (isOnline) mode = "online";
  else if (isHybrid) mode = "hybrid";

  const days = isOnline ? "" : parseDays(daysRaw);
  const timeStr = isOnline ? "" : timesRaw;
  const { start, end } = parseTime(timeStr);

  // Start date from dates cell (e.g. "8/21/2026 - 10/10/2026")
  const startDate = parseDate(datesRaw);

  // Credits: look for first numeric-like value in creditsRaw
  const creditsMatch = creditsRaw.match(/(\d+(?:\.\d+)?)/);
  const credits = creditsMatch ? Math.round(parseFloat(creditsMatch[1])) : 3;

  // Instructor
  let instructor: string | null = instructorRaw || null;
  if (instructor && /tba|staff|^$/i.test(instructor.trim())) instructor = null;

  // Seats open from status ("Open" / "Closed" / "N Seats Available")
  let seatsOpen: number | null = null;
  if (/open/i.test(statusRaw)) seatsOpen = 1;
  else if (/closed/i.test(statusRaw)) seatsOpen = 0;
  const seatsMatch = statusRaw.match(/(\d+)/);
  if (seatsMatch) seatsOpen = parseInt(seatsMatch[1], 10);

  // Campus: extract from location — parenthetical city name or first word
  const campusMatch = location.match(/\(([^)]+)\)/);
  const campus = campusMatch ? campusMatch[1] : location.split(/[\s/]/)[0] || "";

  return {
    college_code: COLLEGE_SLUG,
    term: fileTermCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn,
    days,
    start_time: start,
    end_time: end,
    start_date: startDate,
    location,
    campus,
    mode,
    instructor,
    seats_open: seatsOpen,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function parseHtml(html: string, fileTermCode: string): CourseSection[] {
  const sections: CourseSection[] = [];
  // Each row: <tr><td><a href='CourseDetail.aspx?course_section_id=NNNN'>Select</a></td>...
  const rowPattern = /<tr><td><a href='CourseDetail\.aspx\?course_section_id=(\d+)'[^>]*>Select<\/a><\/td>(.*?)<\/tr>/gs;
  for (const match of html.matchAll(rowPattern)) {
    const crn = match[1];
    const rowHtml = match[2];
    // Split into cells
    const cellMatches = [...rowHtml.matchAll(/<td[^>]*>(.*?)<\/td>/gs)];
    const cells = [""].concat(cellMatches.map(m => m[1])); // 0=select placeholder, 1+=real cells
    const section = parseRow(cells, crn, fileTermCode);
    if (section) sections.push(section);
  }
  return sections;
}

async function getTokensAndCookies(): Promise<{
  viewstate: string;
  viewstateGen: string;
  eventVal: string;
  cookie: string;
}> {
  const res = await fetch(BASE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept-Encoding": "identity",
    },
  });
  const html = await res.text();
  const vs = html.match(/id="__VIEWSTATE" value="([^"]+)"/)?.[1] || "";
  const vsg = html.match(/id="__VIEWSTATEGENERATOR" value="([^"]+)"/)?.[1] || "";
  const ev = html.match(/id="__EVENTVALIDATION" value="([^"]+)"/)?.[1] || "";
  const setCookie = res.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.match(/ASP\.NET_SessionId=[^;]+/)?.[0] || "";
  return { viewstate: vs, viewstateGen: vsg, eventVal: ev, cookie: sessionCookie };
}

async function postSearch(
  termValue: string,
  subject: string,
  tokens: ReturnType<typeof getTokensAndCookies> extends Promise<infer T> ? T : never,
): Promise<string> {
  const body = new URLSearchParams({
    __VIEWSTATE: tokens.viewstate,
    __VIEWSTATEGENERATOR: tokens.viewstateGen,
    __EVENTVALIDATION: tokens.eventVal,
    "ctl00$ContentPlaceHolder1$listBoxTerm": termValue,
    "ctl00$ContentPlaceHolder1$ddlSubject": subject,
    "ctl00$ContentPlaceHolder1$Button1": "Search",
  });
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept-Encoding": "identity",
      "Referer": BASE_URL,
      ...(tokens.cookie ? { Cookie: tokens.cookie } : {}),
    },
    body: body.toString(),
  });
  return res.text();
}

async function scrapeTerm(
  termName: string,
  termValue: string,
  fileTermCode: string,
  subjectFilter: string | null,
): Promise<CourseSection[]> {
  const subjects = subjectFilter ? [subjectFilter] : PBSC_SUBJECTS;
  const sections: CourseSection[] = [];
  console.log(`\n  ${termName} (${termValue}) — ${subjects.length} subjects`);

  for (let si = 0; si < subjects.length; si++) {
    const subject = subjects[si];
    process.stdout.write(`  [${si + 1}/${subjects.length}] ${subject.padEnd(6)} `);
    try {
      const tokens = await getTokensAndCookies();
      const html = await postSearch(termValue, subject, tokens);

      if (html.includes("ViewStateException") || html.includes("Server Error")) {
        console.log("→ viewstate error");
        await sleep(1000);
        continue;
      }

      const parsed = parseHtml(html, fileTermCode);
      sections.push(...parsed);
      console.log(`→ ${parsed.length}`);

      if ((si + 1) % 20 === 0 && sections.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(DATA_DIR, `${fileTermCode}.partial.json`),
          JSON.stringify(sections, null, 2) + "\n",
        );
      }
      await sleep(300);
    } catch (err) {
      console.log(`→ err: ${(err as Error).message?.slice(0, 60)}`);
    }
  }
  return sections;
}

async function main() {
  const { terms, subjectFilter } = parseArgs();
  console.log(`\nPalm Beach State College — ${terms.join(", ")}`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;
  for (const termName of terms) {
    const cfg = TERM_MAP[termName];
    if (!cfg) { console.error(`Unknown term: ${termName}`); process.exit(1); }
    const sections = await scrapeTerm(termName, cfg.value, cfg.file, subjectFilter);
    if (sections.length > 0) {
      const p = path.join(DATA_DIR, `${cfg.file}.json`);
      fs.writeFileSync(p, JSON.stringify(sections, null, 2) + "\n");
      const partial = path.join(DATA_DIR, `${cfg.file}.partial.json`);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    }
    console.log(`\n  ${termName}: ${sections.length} sections`);
    total += sections.length;
  }
  console.log(`\nDone! ${total} sections total\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
