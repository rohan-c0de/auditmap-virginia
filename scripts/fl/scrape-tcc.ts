/**
 * scrape-tcc.ts — Tallahassee State College (formerly TCC) class search
 *
 * TSC's "PublicClassSearch" app at link.tsc.fl.edu exposes a clean
 * server-rendered HTML API used by the SPA. Three POST endpoints:
 *
 *   POST /PublicClassSearch/Home/GetCourseResults
 *     filters[AcademicPeriods][]=<termId>   (e.g. 202711 = Fall 2026 Main)
 *     -> HTML fragment with one <div data-courseid="..."> per course
 *
 *   POST /PublicClassSearch/Home/GetCourseSectionResults
 *     filters[AcademicPeriods][]=<termId>
 *     courseid=<courseId>                   (the data-courseid value)
 *     -> HTML fragment with one row per section
 *
 * No auth, no Playwright needed. Cookies from the initial GET are
 * threaded through subsequent POSTs.
 *
 * Term codes (as of 2026-05-30):
 *   202711 = Fall 2026 (Main)
 *   20263C = Summer 2026 (Main)
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-tcc.ts
 *   npx tsx scripts/fl/scrape-tcc.ts --term "Fall 2026"
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://link.tsc.fl.edu";
const SEARCH_PAGE = `${BASE}/publicclasssearch`;
const COURSES_URL = `${BASE}/PublicClassSearch/Home/GetCourseResults`;
const SECTIONS_URL = `${BASE}/PublicClassSearch/Home/GetCourseSectionResults`;

const COLLEGE_SLUG = "tcc-fl";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

const TERM_MAP: Record<string, { id: string; file: string }> = {
  "Summer 2026": { id: "20263C", file: "2026SU" },
  "Fall 2026":   { id: "202711", file: "2026FA" },
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

function parseArgs() {
  const args = process.argv.slice(2);
  let termArg = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return termArg.split(",").map(t => t.trim()).filter(Boolean);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function normDays(raw: string): string {
  // TCC uses "MWF" or "TR" or "MTWRF" single-letter pattern
  const map: Record<string, string> = {
    M: "Mo", T: "Tu", W: "We", R: "Th", F: "Fr", S: "Sa", U: "Su",
  };
  return raw.replace(/\s+/g, "").split("").map(c => map[c] || "").join("");
}

function normTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
  if (!m) return "";
  return `${m[1]}:${m[2]}${m[3].toUpperCase()}`;
}

interface Session {
  cookie: string;
}

async function startSession(): Promise<Session> {
  const res = await fetch(SEARCH_PAGE, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept-Encoding": "identity",
    },
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const cookies: string[] = [];
  const aspSess = setCookie.match(/ASP\.NET_SessionId=[^;]+/);
  const reqVer = setCookie.match(/__RequestVerificationToken[^;]*=[^;]+/);
  if (aspSess) cookies.push(aspSess[0]);
  if (reqVer) cookies.push(reqVer[0]);
  return { cookie: cookies.join("; ") };
}

async function postForm(url: string, params: URLSearchParams, sess: Session): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": SEARCH_PAGE,
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept-Encoding": "identity",
      ...(sess.cookie ? { Cookie: sess.cookie } : {}),
    },
    body: params.toString(),
  });
  return res.text();
}

async function fetchCourses(termId: string, sess: Session): Promise<string[]> {
  const params = new URLSearchParams();
  params.append("filters[AcademicPeriods][]", termId);
  const html = await postForm(COURSES_URL, params, sess);
  const ids: string[] = [];
  for (const m of html.matchAll(/data-courseid="([^"]+)"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

function parseSectionsHtml(html: string, fileTermCode: string, courseId: string): CourseSection[] {
  const sections: CourseSection[] = [];
  // courseId format: "<PREFIX><NUMBER><Title>" with no separators, e.g. "ACG2021Financial Accounting"
  // We need to split on the boundary between number and title (first uppercase letter
  // after the digits, but the title might start with any letter).
  const idMatch = courseId.match(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)([A-Za-z].*)$/);
  if (!idMatch) return sections;
  const [, prefix, number, title] = idMatch;

  // Each section is wrapped in:
  //   <div id="CourseSectionResult" data-coursesectionid="COURSE_SECTION_DEFINITION-3-140523" ...>
  //     <div class="courseSectionDetailsSummary tcc-row">
  //       <div class="tcc-col courseSectionId-col">013</div>
  //       <div class="tcc-col deliveryMode-col">Closed</div>
  //       <div class="tcc-col startTime-col">9:00 AM</div>
  //       <div class="tcc-col endTime-col">10:50 AM</div>
  //       <div class="tcc-col room-col">Online</div>
  //       <div class="tcc-col meetingPattern-col tcc-row">M W F</div>
  //     </div>
  //   </div>
  const blockPattern =
    /<div\s+id="CourseSectionResult"\s+data-coursesectionid="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  for (const m of html.matchAll(blockPattern)) {
    const sectionId = m[1];
    const block = m[2];

    const grab = (col: string): string => {
      const r = new RegExp(`<div class="tcc-col ${col}[^"]*">([^<]*)<`);
      const x = block.match(r);
      return x ? x[1].trim() : "";
    };

    const sectNum = grab("courseSectionId-col");
    const status = grab("deliveryMode-col");        // "Open" / "Closed" / "Waitlist"
    const startTime = grab("startTime-col");
    const endTime = grab("endTime-col");
    const room = grab("room-col");
    // meetingPattern-col is followed by inner text after the div tag
    const dpMatch = block.match(/meetingPattern-col[^>]*>([\s\S]*?)<\/div>/);
    const daysRaw = dpMatch ? stripTags(dpMatch[1]) : "";

    if (!sectNum) continue;

    const isOnline = /online|web/i.test(room) || /^online$/i.test(daysRaw);
    const isHybrid = /hybrid/i.test(room);

    let seatsOpen: number | null = null;
    if (/open/i.test(status)) seatsOpen = 1;
    else if (/closed|wait/i.test(status)) seatsOpen = 0;

    sections.push({
      college_code: COLLEGE_SLUG,
      term: fileTermCode,
      course_prefix: prefix,
      course_number: number,
      course_title: title.trim(),
      credits: 3,
      crn: `${prefix}${number}-${sectNum}`,
      days: isOnline ? "" : normDays(daysRaw),
      start_time: normTime(startTime),
      end_time: normTime(endTime),
      start_date: "",
      location: room,
      campus: "",
      mode: isOnline ? "online" : isHybrid ? "hybrid" : "in-person",
      instructor: null,
      seats_open: seatsOpen,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function fetchSections(courseId: string, termId: string, fileTermCode: string, sess: Session): Promise<CourseSection[]> {
  // TCC server is picky: spaces in courseid must be %20 (not + as URLSearchParams encodes).
  const body = `filters[AcademicPeriods][]=${termId}&courseid=${encodeURIComponent(courseId)}`;
  const res = await fetch(SECTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": SEARCH_PAGE,
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept-Encoding": "identity",
      ...(sess.cookie ? { Cookie: sess.cookie } : {}),
    },
    body,
  });
  const html = await res.text();
  return parseSectionsHtml(html, fileTermCode, courseId);
}

async function scrapeTerm(termName: string, termId: string, fileTermCode: string): Promise<CourseSection[]> {
  console.log(`\n  ${termName} (${termId})`);
  const sess = await startSession();
  const courseIds = await fetchCourses(termId, sess);
  console.log(`  ${courseIds.length} courses found`);

  const all: CourseSection[] = [];
  for (let i = 0; i < courseIds.length; i++) {
    const cid = courseIds[i];
    try {
      const secs = await fetchSections(cid, termId, fileTermCode, sess);
      all.push(...secs);
      if ((i + 1) % 50 === 0) {
        console.log(`    [${i + 1}/${courseIds.length}] running total: ${all.length} sections`);
        if (all.length > 0) {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(
            path.join(DATA_DIR, `${fileTermCode}.partial.json`),
            JSON.stringify(all, null, 2) + "\n",
          );
        }
      }
    } catch (err) {
      console.log(`    [${i + 1}] ${cid.slice(0, 30)} → err: ${(err as Error).message?.slice(0, 50)}`);
    }
    await sleep(150);
  }
  return all;
}

async function main() {
  const terms = parseArgs();
  console.log(`\nTallahassee State College — ${terms.join(", ")}`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;
  for (const termName of terms) {
    const cfg = TERM_MAP[termName];
    if (!cfg) { console.error(`Unknown term: ${termName}`); process.exit(1); }
    const sections = await scrapeTerm(termName, cfg.id, cfg.file);
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
