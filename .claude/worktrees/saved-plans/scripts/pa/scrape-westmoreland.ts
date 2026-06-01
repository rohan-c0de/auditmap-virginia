/**
 * Westmoreland County Community College — CampusNexus / Anthology scraper
 *
 * WCC publishes its class schedule via the CampusNexus Student / Anthology
 * CMCPortal at:
 *
 *   https://sisportal-100910.campusnexus.cloud/CMCPortal/Common/CourseSchedule.aspx
 *
 * This is a classic ASP.NET WebForms application:
 *   1. GET the page → capture __VIEWSTATE / __VIEWSTATEGENERATOR /
 *      __EVENTVALIDATION plus the ASP.NET session cookie.
 *   2. POST the form with the desired term + "Open & Closed" sections
 *      + a click on btnSearch. The response HTML re-renders with the
 *      result table.
 *   3. Parse the result table: each row is one section, with the
 *      following <td>s:
 *        0: Course code (e.g. "ELC199")  →  prefix + number
 *        1: Course title
 *        2: Section code
 *        3: Date range "8/17/2026 to 12/12/2026"
 *        4: Credits
 *        5: Schedule text — usually "No Scheduled Meetings" in the
 *           search results; the actual day/time is in a popup behind
 *           a "Click for Details" __doPostBack link, which would
 *           require a follow-up POST per section. Left as a TODO.
 *        6: Instructor
 *        7: Class Type
 *        8: Delivery Method ("Face to Face", "Online", etc.)
 *        9: Course Attribute
 *       10: Class Comments
 *       11: Availability "N of M"  →  seats_open + seats_total
 *
 * Anti-quirk note: Node's default fetch sends `Accept-Encoding: gzip`
 * which this server mis-handles, returning a 500 redirect to a "Runtime
 * Error" page. Force `Accept-Encoding: identity` on every request.
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-westmoreland.ts
 *   npx tsx scripts/pa/scrape-westmoreland.ts --no-import
 *   npx tsx scripts/pa/scrape-westmoreland.ts --list-terms
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "pa";
const COLLEGE_SLUG = "westmoreland";
const BASE_URL =
  "https://sisportal-100910.campusnexus.cloud/CMCPortal/Common/CourseSchedule.aspx";
const CAMPUS_VALUE = "5"; // Westmoreland County CC
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

const COMMON_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
} as const;

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
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface TermOption {
  value: string;
  label: string;
}

function extractHiddenValue(html: string, name: string): string {
  const idx = html.indexOf(`name="${name}"`);
  if (idx === -1) return "";
  const tag = html.substring(idx, idx + 30000);
  const v = tag.match(/value="([^"]*)"/);
  return v ? v[1] : "";
}

function extractTermOptions(html: string): TermOption[] {
  // Look for the cbTerm <select> options. The select tag wraps all <option>
  // children; we narrow to the relevant region.
  const startIdx = html.indexOf(`name="_ctl0:PlaceHolderMain:_ctl0:cbTerm"`);
  if (startIdx === -1) return [];
  const region = html.substring(startIdx, startIdx + 5000);
  const optRegex = /<option[^>]*value="(-?\d+)"[^>]*>([^<]+)</g;
  const out: TermOption[] = [];
  let m: RegExpExecArray | null;
  while ((m = optRegex.exec(region)) !== null) {
    if (m[1] === "-1") continue;
    out.push({ value: m[1], label: m[2].trim() });
  }
  return out;
}

function termLabelToCode(label: string): string {
  // "2026 Fall" / "2026 Summer" / "2026 Winter" / "2026 Spring CHS"
  // (CHS = "College in High School" dual-enrollment — same year/season).
  const m = label.match(/(\d{4})\s+(Fall|Spring|Summer|Winter)/i);
  if (!m) return label.replace(/\s+/g, "");
  const season = m[2].toUpperCase().slice(0, 2);
  return `${m[1]}${season}`;
}

async function fetchInitialPage(): Promise<{
  cookie: string;
  viewState: string;
  viewStateGen: string;
  eventValidation: string;
  termOptions: TermOption[];
}> {
  const r = await fetch(BASE_URL, { headers: COMMON_HEADERS });
  if (!r.ok) throw new Error(`Initial GET failed: HTTP ${r.status}`);
  const html = await r.text();
  const setCookies = r.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  return {
    cookie,
    viewState: extractHiddenValue(html, "__VIEWSTATE"),
    viewStateGen: extractHiddenValue(html, "__VIEWSTATEGENERATOR"),
    eventValidation: extractHiddenValue(html, "__EVENTVALIDATION"),
    termOptions: extractTermOptions(html),
  };
}

async function searchTerm(
  termValue: string,
  cookie: string,
  viewState: string,
  viewStateGen: string,
  eventValidation: string,
): Promise<string> {
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGen,
    __EVENTVALIDATION: eventValidation,
    "_ctl0:PlaceHolderMain:_ctl0:cbCampus": CAMPUS_VALUE,
    "_ctl0:PlaceHolderMain:_ctl0:cbTerm": termValue,
    "_ctl0:PlaceHolderMain:_ctl0:txtKeyword": "",
    "_ctl0:PlaceHolderMain:_ctl0:txtCode": "",
    "_ctl0:PlaceHolderMain:_ctl0:Sections": "rbOC",
    "_ctl0:PlaceHolderMain:_ctl0:btnSearch": "Search",
  });
  const r = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Referer: BASE_URL,
    },
    body,
  });
  if (!r.ok) throw new Error(`POST failed: HTTP ${r.status}`);
  return r.text();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCourseCode(raw: string): { prefix: string; number: string } | null {
  // "ELC199" → ELC + 199; "MATH 100" → MATH + 100
  const m = raw.trim().match(/^([A-Z]{2,4})\s*(\d{3,4}[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function parseDateRange(text: string): string {
  // "8/17/2026 to 12/12/2026" → "2026-08-17"
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseSeats(text: string): { open: number | null; total: number | null } {
  // "1 of 1" / "12 of 20"
  const m = text.match(/(\d+)\s+of\s+(\d+)/i);
  if (!m) return { open: null, total: null };
  return { open: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function detectMode(deliveryMethod: string): CourseSection["mode"] {
  const d = deliveryMethod.toLowerCase();
  if (d.includes("online") || d.includes("internet")) return "online";
  if (d.includes("hybrid") || d.includes("blended")) return "hybrid";
  if (d.includes("zoom") || d.includes("remote")) return "zoom";
  return "in-person";
}

function parseRow(rowHtml: string, term: string): CourseSection | null {
  // Only rows with lblInstructor are actual section rows; headers etc. lack it.
  if (!rowHtml.includes("lblInstructor")) return null;

  const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
    (m) => m[1],
  );
  if (tds.length < 12) return null;

  const courseCodeRaw = stripTags(tds[0]);
  const code = parseCourseCode(courseCodeRaw);
  if (!code) return null;

  const title = stripTags(tds[1]);
  const sectionCode = stripTags(tds[2]);
  const dateRange = stripTags(tds[3]);
  const credits = parseFloat(stripTags(tds[4]));
  const instructor = stripTags(tds[6]);
  const deliveryMethod = stripTags(tds[8]);
  const availability = stripTags(tds[11]);

  const seats = parseSeats(availability);

  return {
    college_code: COLLEGE_SLUG,
    term,
    course_prefix: code.prefix,
    course_number: code.number,
    course_title: title,
    credits: isNaN(credits) ? 0 : credits,
    crn: `${code.prefix}${code.number}-${sectionCode}`,
    days: "",
    start_time: "",
    end_time: "",
    start_date: parseDateRange(dateRange),
    location: "",
    campus: "Westmoreland",
    mode: detectMode(deliveryMethod),
    instructor: instructor && instructor !== "Pending-Faculty,Westmoreland" ? instructor : null,
    seats_open: seats.open,
    seats_total: seats.total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function parseResults(html: string, term: string): CourseSection[] {
  const out: CourseSection[] = [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  for (const r of rows) {
    const sec = parseRow(r[1], term);
    if (sec) out.push(sec);
  }
  return out;
}

function pickTargetTerms(options: TermOption[]): TermOption[] {
  // Take terms in the current calendar year. Skip CHS dual-enrollment
  // variants (these mirror the regular term but with different
  // registration rules — duplicating them would inflate counts).
  const currentYear = new Date().getFullYear().toString();
  return options.filter(
    (o) =>
      o.label.startsWith(currentYear) &&
      !o.label.includes("CHS"),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const listTerms = args.includes("--list-terms");

  console.log(`=== Westmoreland CCC scraper ===\n  Endpoint: ${BASE_URL}`);
  const initial = await fetchInitialPage();
  console.log(
    `  Got VIEWSTATE (${initial.viewState.length} chars), ${initial.termOptions.length} term options`,
  );

  if (listTerms) {
    for (const t of initial.termOptions) {
      console.log(`  ${t.value}\t${t.label}\t→ ${termLabelToCode(t.label)}`);
    }
    return;
  }

  const targets = pickTargetTerms(initial.termOptions);
  console.log(`  Targeting ${targets.length} term(s): ${targets.map((t) => t.label).join(", ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  const results: { term: string; sections: number }[] = [];
  for (const target of targets) {
    const term = termLabelToCode(target.label);
    console.log(`\n  Scraping ${target.label} (${target.value} → ${term})...`);
    // Re-fetch VIEWSTATE per term — ASP.NET WebForms is finicky about
    // re-using stale state across multiple search submissions.
    const sessionState = await fetchInitialPage();
    const html = await searchTerm(
      target.value,
      sessionState.cookie,
      sessionState.viewState,
      sessionState.viewStateGen,
      sessionState.eventValidation,
    );
    const sections = parseResults(html, term);
    if (sections.length === 0) {
      console.log(`    No sections found.`);
      results.push({ term, sections: 0 });
      continue;
    }
    fs.writeFileSync(
      path.join(outDir, `${term}.json`),
      JSON.stringify(sections, null, 2),
    );
    console.log(`    ✓ ${sections.length} sections → ${term}.json`);
    results.push({ term, sections: sections.length });
    grandTotal += sections.length;
  }

  console.log("\n=== Summary ===");
  for (const r of results) console.log(`  ${r.term}: ${r.sections}`);
  console.log(`  Total: ${grandTotal} sections`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
