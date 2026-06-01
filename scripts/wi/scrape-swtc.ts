/**
 * scrape-swtc.ts — Southwest Wisconsin Technical College course scraper.
 *
 * SWTC uses a CMC Portal (Campus Management Corporation, ASP.NET WebForms)
 * at https://myswtc.swtc.edu/CMCPortal/Common/CourseSchedule.aspx.
 *
 * Flow: GET the form page → extract __VIEWSTATE + __EVENTVALIDATION →
 * POST with campus=5, term={TERM_ID}, btnSearch=Search → parse the
 * <table id="CourseList"> in the response (~454 Fall 2026 sections).
 *
 * No CRN is exposed; unique key = course_code + section_code (e.g.
 * "10-623-110|0080"). Meeting times are in column 5 (Schedule), format
 * "Mo 1:00PM - 3:53PM" or "No Scheduled Meetings" for online.
 *
 * Usage:
 *   npx tsx scripts/wi/scrape-swtc.ts
 *   npx tsx scripts/wi/scrape-swtc.ts --term 314
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as querystring from "querystring";

const SLUG = "southwest-wisconsin-technical-college";
const STATE = "wi";
const BASE_URL = "https://myswtc.swtc.edu/CMCPortal/Common/CourseSchedule.aspx";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

// Only degree-level terms (skip NONDEG parent terms)
const TERMS: Record<string, string> = {
  "314": "2026FA",
  "313": "2026SU",
};

const DAYS_MAP: Record<string, string> = {
  Su: "U",
  Mo: "M",
  Tu: "T",
  We: "W",
  Th: "R",
  Fr: "F",
  Sa: "S",
};

interface Section {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  section: string;
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
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function parseDays(schedule: string): string {
  const days: string[] = [];
  // Match day abbreviations: Su, Mo, Tu, We, Th, Fr, Sa
  const matches = schedule.match(/(Su|Mo|Tu|We|Th|Fr|Sa)/g);
  if (matches) {
    for (const m of matches) {
      if (DAYS_MAP[m]) days.push(DAYS_MAP[m]);
    }
  }
  return days.join("");
}

function parseTime(schedule: string): { start: string; end: string } {
  const match = schedule.match(
    /(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)/i
  );
  if (match) return { start: match[1], end: match[2] };
  return { start: "", end: "" };
}

function parseMode(delivery: string): string {
  const lower = delivery.toLowerCase();
  if (lower.includes("online")) return "online";
  if (lower.includes("hybrid") || lower.includes("blended")) return "hybrid";
  if (lower.includes("hyflex")) return "hybrid";
  return "in-person";
}

function parseSeats(text: string): { open: number | null; total: number | null } {
  const match = text.match(/(\d+)\s*of\s*(\d+)/);
  if (match) return { open: parseInt(match[1]), total: parseInt(match[2]) };
  return { open: null, total: null };
}

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string
): Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers as Record<string, string | string[]>,
          body: data,
        })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getFormState(): Promise<{
  viewstate: string;
  viewstateGenerator: string;
  eventValidation: string;
  cookies: string;
}> {
  const resp = await httpsRequest(BASE_URL, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (resp.statusCode !== 200) throw new Error(`GET failed: ${resp.statusCode}`);

  const setCookies = Array.isArray(resp.headers["set-cookie"])
    ? resp.headers["set-cookie"]
    : resp.headers["set-cookie"]
      ? [resp.headers["set-cookie"]]
      : [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  const $ = cheerio.load(resp.body);

  return {
    viewstate: $('input[name="__VIEWSTATE"]').val() as string,
    viewstateGenerator: $('input[name="__VIEWSTATEGENERATOR"]').val() as string,
    eventValidation: $('input[name="__EVENTVALIDATION"]').val() as string,
    cookies,
  };
}

async function searchTerm(
  termId: string,
  formState: { viewstate: string; viewstateGenerator: string; eventValidation: string; cookies: string }
): Promise<string> {
  const body = querystring.stringify({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: formState.viewstate,
    __VIEWSTATEGENERATOR: formState.viewstateGenerator,
    __EVENTVALIDATION: formState.eventValidation,
    "_ctl0:PlaceHolderMain:_ctl0:cbCampus": "5",
    "_ctl0:PlaceHolderMain:_ctl0:cbTerm": termId,
    "_ctl0:PlaceHolderMain:_ctl0:txtKeyword": "",
    "_ctl0:PlaceHolderMain:_ctl0:chkMo": "on",
    "_ctl0:PlaceHolderMain:_ctl0:chkTu": "on",
    "_ctl0:PlaceHolderMain:_ctl0:chkWe": "on",
    "_ctl0:PlaceHolderMain:_ctl0:chkTh": "on",
    "_ctl0:PlaceHolderMain:_ctl0:chkFr": "on",
    "_ctl0:PlaceHolderMain:_ctl0:chkSa": "on",
    "_ctl0:PlaceHolderMain:_ctl0:chkSu": "on",
    "_ctl0:PlaceHolderMain:_ctl0:Sections": "rbOC",
    "_ctl0:PlaceHolderMain:_ctl0:txtCode": "",
    "_ctl0:PlaceHolderMain:_ctl0:btnSearch": "Search",
  });

  const resp = await httpsRequest(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: formState.cookies,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Content-Length": Buffer.byteLength(body).toString(),
    },
  }, body);

  if (resp.statusCode !== 200) throw new Error(`POST failed: ${resp.statusCode}`);
  return resp.body;
}

function parseResults(html: string, termCode: string): Section[] {
  const $ = cheerio.load(html);
  const sections: Section[] = [];

  $("#CourseList tr").each((idx, row) => {
    if (idx === 0) return; // skip header

    const tds = $(row).find("td");
    if (tds.length < 12) return;

    const courseCode = $(tds[0]).text().trim();
    const courseTitle = $(tds[1]).text().trim();
    const sectionCode = $(tds[2]).text().trim();
    const dateRange = $(tds[3]).text().trim();
    const credits = parseFloat($(tds[4]).text().trim()) || 0;
    const schedule = $(tds[5]).text().trim();
    const instructor = $(tds[6]).text().trim() || null;
    const delivery = $(tds[8]).text().trim();
    const courseAttr = $(tds[9]).text().trim();
    const seatsText = $(tds[11]).text().trim();

    // Skip non-degree courses
    if (courseAttr.toLowerCase().includes("non-degree")) return;

    // Parse date range "M/D/YYYY to M/D/YYYY"
    const dateMatch = dateRange.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*to\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    let startDate = "";
    let endDate = "";
    if (dateMatch) {
      startDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;
      endDate = `${dateMatch[6]}-${dateMatch[4].padStart(2, "0")}-${dateMatch[5].padStart(2, "0")}`;
    }

    const days = parseDays(schedule);
    const { start: startTime, end: endTime } = parseTime(schedule);
    const mode = parseMode(delivery);
    const { open: seatsOpen, total: seatsTotal } = parseSeats(seatsText);

    // Course code format: "NN-NNN-NNN" — prefix = first two digits
    const codeParts = courseCode.split("-");
    const prefix = codeParts[0] || courseCode;
    const number = codeParts.slice(1).join("-") || courseCode;

    sections.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: prefix,
      course_number: number,
      course_title: courseTitle,
      credits,
      crn: `${courseCode}|${sectionCode}`,
      section: sectionCode,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      end_date: endDate,
      location: mode === "online" ? "Online" : "Fennimore Campus",
      campus: "SWTC",
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
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("SWTC (Southwest Wisconsin Technical College) course scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const formState = await getFormState();
  console.log(`  Form state captured (viewstate: ${formState.viewstate.length} chars)`);

  const termsToScrape = termFilter
    ? { [termFilter]: TERMS[termFilter] || `TERM${termFilter}` }
    : TERMS;

  let grandTotal = 0;
  for (const [termId, termCode] of Object.entries(termsToScrape)) {
    console.log(`  Searching term ${termCode} (ID ${termId})...`);
    try {
      const html = await searchTerm(termId, formState);
      const sections = parseResults(html, termCode);
      if (sections.length > 0) {
        const outPath = path.join(COURSES_DIR, `${termCode}.json`);
        fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
        console.log(`    ${sections.length} sections written to ${outPath}`);
        grandTotal += sections.length;
      } else {
        console.log(`    No degree-level sections for ${termCode}`);
      }
    } catch (e) {
      console.error(`    Error scraping ${termCode}: ${e}`);
    }
    // Brief pause between terms
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n  Total: ${grandTotal} sections`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
