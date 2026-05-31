/**
 * scrape-cf.ts — College of Central Florida (CF) class search
 *
 * CF uses Jenzabar CX 1.10 (a desktop ERP) but exposes a public CGI
 * gateway at register.cf.edu:9040/cgi-bin/public/. Flow:
 *
 *   1. POST setopt.cgi to set (prog=CC, sess=FA|SP|SU, yr=2026) in
 *      the session cookie.
 *   2. POST crscat.cgi command="Execute Search" with department=<code>
 *      to get the section table for that department in that term.
 *
 * The result table has columns:
 *   Course | Sect | Title | Instruct Method | Campus | Instructor
 *     | Seats | Cred | Reqmts | Textbk | Dates | DayPattern (e.g. _M_W___)
 *     | StartTime | EndTime | Building | Room | TextbookAvail | Cost | ...
 *
 * Day pattern is 7 chars: M T W H F S U (H=Thursday, U=Sunday); underscore
 * = no class that day.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-cf.ts
 *   npx tsx scripts/fl/scrape-cf.ts --term "Fall 2026"
 *   npx tsx scripts/fl/scrape-cf.ts --term "Fall 2026" --dept MATH
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://register.cf.edu:9040/cgi-bin/public";
const SETOPT_URL = `${BASE}/setopt.cgi`;
const SEARCH_URL = `${BASE}/crscat.cgi`;

const COLLEGE_SLUG = "cf";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

const TERM_MAP: Record<string, { sess: string; yr: string; file: string }> = {
  "Summer 2026": { sess: "SU", yr: "2026", file: "2026SU" },
  "Fall 2026":   { sess: "FA", yr: "2026", file: "2026FA" },
  "Spring 2027": { sess: "SP", yr: "2027", file: "2027SP" },
};

const CF_DEPARTMENTS = [
  "ACCT","AGRI","ART","BAS","BSN","BUS","CVT","CDEV","CIS","CRIM","DANC","DNTL","DNTH","SONO",
  "EDU","EPI","EMS","ENGT","ELJ","EQUI","FSCI","LANG","HIM","HWF","HORT","HOSP","HUMT","LOGI",
  "MATH","MUSC","OFCT","OHLT","LGLA","PHTH","RAD","NURS","RESP","SCIB","SCIP","SOSC","SURG",
  "TECH","THEA","WELD",
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
  let deptFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
    else if (args[i] === "--dept" && args[i + 1]) { deptFilter = args[i + 1].toUpperCase(); i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return { terms: termArg.split(",").map(t => t.trim()).filter(Boolean), deptFilter };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Day pattern is _M_W___ style — convert to Mo/We/etc.
 * Positions: 0=Mon 1=Tue 2=Wed 3=Thu(H) 4=Fri 5=Sat 6=Sun(U)
 */
function parseCfDays(raw: string): string {
  if (!raw || /to be announced|tba/i.test(raw)) return "";
  const map = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const trimmed = raw.replace(/\s/g, "");
  if (trimmed.length !== 7) return "";
  let out = "";
  for (let i = 0; i < 7; i++) {
    if (trimmed[i] !== "_") out += map[i];
  }
  return out;
}

function parseCfTime(raw: string): string {
  // CF format: "10:00a" or "1:30p"
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})([ap])$/i);
  if (!m) return "";
  return `${m[1]}:${m[2]}${m[3].toUpperCase()}M`;
}

function parseCfDate(raw: string): string {
  // "08/17/2026 - 12/10/2026" → take start
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

interface Session { cookie: string; }

async function startSession(sess: string, yr: string): Promise<Session> {
  // First GET search to seed cookies
  const r1 = await fetch(`${SEARCH_URL}?command=Search Criteria`, {
    headers: { "User-Agent": "Mozilla/5.0 cc-courseMap", "Accept-Encoding": "identity" },
  });
  const cookie = (r1.headers.get("set-cookie") || "")
    .split(",").map(c => c.split(";")[0]).join("; ");

  // Set options
  const body = new URLSearchParams({
    setopt_command: "Change Options",
    prog: "CC",
    sess,
    yr,
    action: `${SEARCH_URL}?command=Search Criteria`,
  });
  await fetch(SETOPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 cc-courseMap",
      "Accept-Encoding": "identity",
      Cookie: cookie,
    },
    body: body.toString(),
  });
  return { cookie };
}

async function searchDept(dept: string, sess: Session): Promise<string> {
  const body = new URLSearchParams({
    command: "Execute Search",
    department: dept,
    wildCourse: "1",
  });
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 cc-courseMap",
      "Accept-Encoding": "identity",
      Cookie: sess.cookie,
    },
    body: body.toString(),
  });
  return res.text();
}

function parseHtml(html: string, fileTermCode: string): CourseSection[] {
  const sections: CourseSection[] = [];
  // Each section is a <tr> with first cell matching e.g. "MAC1105"
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const r of rows) {
    const cellMatches = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const cells = cellMatches.map(m => stripTags(m[1]));
    if (cells.length < 14) continue;
    const courseField = cells[0];
    const m = courseField.match(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)$/);
    if (!m) continue;
    const prefix = m[1];
    const number = m[2];
    const sect = cells[1];
    const title = cells[2];
    const method = cells[3];
    const campus = cells[4];
    const instructor = cells[5];
    const seatsRaw = cells[6];
    const creditsRaw = cells[7];
    const dates = cells[10] || cells[9] || "";
    const daysRaw = cells[11] || cells[10] || "";
    const startTime = cells[12] || cells[11] || "";
    const endTime = cells[13] || cells[12] || "";
    const building = cells[14] || "";
    const room = cells[15] || "";

    const isOnline = /online/i.test(method) || /online/i.test(campus);
    const isHybrid = /hybrid/i.test(method);

    let seatsTotal: number | null = null;
    const seatsMatch = seatsRaw.match(/(\d+)/);
    if (seatsMatch) seatsTotal = parseInt(seatsMatch[1], 10);

    const inst = instructor && !/^staff$|^tba$/i.test(instructor) ? instructor : null;
    const location = [building, room].filter(Boolean).join(" ").trim();

    sections.push({
      college_code: COLLEGE_SLUG,
      term: fileTermCode,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: Math.round(parseFloat(creditsRaw)) || 3,
      crn: `${prefix}${number}-${sect}`,
      days: isOnline ? "" : parseCfDays(daysRaw),
      start_time: isOnline ? "" : parseCfTime(startTime),
      end_time: isOnline ? "" : parseCfTime(endTime),
      start_date: parseCfDate(dates),
      location: isOnline ? "" : location,
      campus,
      mode: isOnline ? "online" : isHybrid ? "hybrid" : "in-person",
      instructor: inst,
      seats_open: null,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function scrapeTerm(termName: string, fileTermCode: string, sess: string, yr: string, deptFilter: string | null): Promise<CourseSection[]> {
  console.log(`\n  ${termName} (${sess} ${yr})`);
  const s = await startSession(sess, yr);
  const depts = deptFilter ? [deptFilter] : CF_DEPARTMENTS;
  const all: CourseSection[] = [];
  for (let i = 0; i < depts.length; i++) {
    const dept = depts[i];
    process.stdout.write(`  [${i + 1}/${depts.length}] ${dept.padEnd(6)} `);
    try {
      const html = await searchDept(dept, s);
      const parsed = parseHtml(html, fileTermCode);
      all.push(...parsed);
      console.log(`→ ${parsed.length}`);
      if ((i + 1) % 10 === 0 && all.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(DATA_DIR, `${fileTermCode}.partial.json`),
          JSON.stringify(all, null, 2) + "\n",
        );
      }
      await sleep(300);
    } catch (e) {
      console.log(`→ err: ${(e as Error).message?.slice(0, 50)}`);
    }
  }
  return all;
}

async function main() {
  const { terms, deptFilter } = parseArgs();
  console.log(`\nCollege of Central Florida — ${terms.join(", ")}`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;
  for (const termName of terms) {
    const cfg = TERM_MAP[termName];
    if (!cfg) { console.error(`Unknown term: ${termName}`); process.exit(1); }
    const sections = await scrapeTerm(termName, cfg.file, cfg.sess, cfg.yr, deptFilter);
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
