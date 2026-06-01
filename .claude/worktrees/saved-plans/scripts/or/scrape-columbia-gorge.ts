/**
 * Columbia Gorge Community College — Jenzabar CMC Portal (ASP.NET WebForms) scraper
 *
 * CGCC publishes a public course schedule at:
 *   https://my.cgcc.edu/CMCPortal/Common/CourseSchedule.aspx
 *
 * The form is classic ASP.NET WebForms — needs a GET to harvest VIEWSTATE,
 * VIEWSTATEGENERATOR, EVENTVALIDATION, then a POST with those fields plus
 * the search criteria.
 *
 * Result row HTML (12 cells):
 *   [0]  span#lblCourseCode  — course code (e.g. "HEC226", no space)
 *   [1]  course title         — plain text
 *   [2]  section              — plain text
 *   [3]  span#DateRange_CourseList — "9/21/2026 to 12/4/2026"
 *   [4]  span#Label1          — credits
 *   [5]  span#lnkDetails      — always "No Scheduled Meetings" in main list
 *                                (days/times require a per-row __doPostBack)
 *   [6]  span#lblInstructor
 *   [7]  span#lblDeliveryMethod  — Face-to-Face / Online / Zoom
 *   [8]  span#lblCourseAttribute
 *   [9]  span#lblClassComment
 *   [10] span#lblAvailability — "23 of 30"
 *   [11] "Click for Details" link
 *
 * Term codes are CGCC-internal (e.g. 378=Fall 2026, 383=Summer 2026).
 *
 * Usage:
 *   npx tsx scripts/or/scrape-columbia-gorge.ts
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "columbia-gorge-community-college";
const STATE = "or";
const BASE = "https://my.cgcc.edu";
const FORM_URL = `${BASE}/CMCPortal/Common/CourseSchedule.aspx`;
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
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface FormState {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  terms: { id: string; label: string; term: string }[];
  cookies: string;
}

function parseCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map((h) => h.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function cgccLabelToTerm(label: string): string {
  // "2026-27 Fall Term" → 2026FA
  // "2026-27 Spring Term" → 2027SP (spring is in the second calendar year)
  // "2026-27 Summer Term" → 2027SU
  // "2026-27 Winter Term" → 2027WI
  const m = label.match(/(\d{4})-\d{2}\s+(Fall|Winter|Spring|Summer)\s+Term/i);
  if (!m) return "";
  const yearStart = parseInt(m[1], 10);
  const season = m[2].toLowerCase();
  if (season === "fall") return `${yearStart}FA`;
  if (season === "winter") return `${yearStart + 1}WI`;
  if (season === "spring") return `${yearStart + 1}SP`;
  if (season === "summer") return `${yearStart + 1}SU`;
  return "";
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function loadForm(): Promise<FormState> {
  const res = await fetch(FORM_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  const html = await res.text();
  const cookies = parseCookies(res.headers.getSetCookie?.() ?? []);
  const $ = cheerio.load(html);

  const viewState = $('input[name="__VIEWSTATE"]').val() as string;
  const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val() as string;
  const eventValidation = $('input[name="__EVENTVALIDATION"]').val() as string;

  const terms: { id: string; label: string; term: string }[] = [];
  $('#_ctl0_PlaceHolderMain__ctl0_cbTerm option').each((_, el) => {
    const id = $(el).attr("value") || "";
    const label = $(el).text().trim();
    if (!id || id === "-1") return;
    const term = cgccLabelToTerm(label);
    if (!term) return;
    terms.push({ id, label, term });
  });

  return { viewState, viewStateGenerator, eventValidation, terms, cookies };
}

async function scrapeTerm(form: FormState, termId: string, termCode: string): Promise<CourseSection[]> {
  const body = new URLSearchParams({
    __VIEWSTATE: form.viewState,
    __VIEWSTATEGENERATOR: form.viewStateGenerator,
    __EVENTVALIDATION: form.eventValidation,
    "_ctl0:PlaceHolderMain:_ctl0:cbCampus": "5",
    "_ctl0:PlaceHolderMain:_ctl0:cbTerm": termId,
    "_ctl0:PlaceHolderMain:_ctl0:cbDept": "-1",
    "_ctl0:PlaceHolderMain:_ctl0:cbLowTime": "0",
    "_ctl0:PlaceHolderMain:_ctl0:cbHighTime": "23",
    "_ctl0:PlaceHolderMain:_ctl0:btnSearch": "Search",
  });

  const res = await fetch(FORM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.5",
      Cookie: form.cookies,
    },
    body: body.toString(),
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $("#CourseList tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 11) return;

    const codeRaw = $(cells[0]).find("[id*=lblCourseCode]").text().trim();
    const title = $(cells[1]).text().trim();
    const section = $(cells[2]).text().trim();
    const dateRange = $(cells[3]).text().replace(/\s+/g, " ").trim();
    const credits = parseFloat($(cells[4]).text().trim()) || 0;
    const instructor = $(cells[6]).text().trim() || null;
    const delivery = $(cells[7]).text().trim();
    const availability = $(cells[10]).text().trim();

    const codeMatch = codeRaw.match(/^([A-Z]{2,5})(\d+[A-Z]?)$/);
    if (!codeMatch) return;

    const startDateMatch = dateRange.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/);
    const startDate = startDateMatch ? startDateMatch[1] : "";

    const availMatch = availability.match(/(\d+)\s+of\s+(\d+)/);
    const seatsOpen = availMatch ? parseInt(availMatch[1], 10) : null;
    const seatsTotal = availMatch ? parseInt(availMatch[2], 10) : null;

    const d = delivery.toLowerCase();
    const mode: "in-person" | "online" | "hybrid" =
      d.includes("hybrid") || d.includes("blended") ? "hybrid" :
      d.includes("online") || d.includes("zoom") || d.includes("remote") ? "online" :
      "in-person";

    sections.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: codeMatch[1],
      course_number: codeMatch[2],
      course_title: title,
      credits,
      crn: `${codeMatch[1]}-${codeMatch[2]}-${section}`,
      days: "",
      start_time: "",
      end_time: "",
      start_date: startDate,
      location: "",
      campus: "The Dalles",
      mode,
      instructor,
      seats_open: seatsOpen,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  console.log("🏞️  Columbia Gorge CC Jenzabar CMC Portal scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const form = await loadForm();
  console.log(`  Found ${form.terms.length} terms: ${form.terms.map((t) => t.term).join(", ")}`);

  const now = new Date();
  const currentYear = now.getFullYear();
  let grandTotal = 0;

  for (const { id, term } of form.terms) {
    const year = parseInt(term.slice(0, 4), 10);
    if (year < currentYear) {
      console.log(`  ${term}: skipping past term`);
      continue;
    }

    // Each search may invalidate VIEWSTATE — refetch the form per term.
    const fresh = await loadForm();
    const sections = await scrapeTerm(fresh, id, term);

    if (sections.length === 0) {
      console.log(`  ${term}: 0 sections, skipping`);
      continue;
    }

    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${term}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ columbia-gorge-community-college: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ CGCC scraper failed:", err);
  process.exit(1);
});
