/**
 * Chippewa Valley Technical College — course scraper
 *
 * CVTC publishes a public course search at https://coursesearch.cvtc.edu/ powered
 * by a PHP back-end that accepts HTML form POST requests.
 *
 * Each department is scraped independently for each term.
 * Results are structured HTML with:
 *   - h3.mb-1: course code (e.g. "804-113") <span> | </span> title
 *   - p: "N Credits | Learn More"
 *   - div.course-info > div per section:
 *       p: "Section #XXX | CRN: NNNNN | $fee | N Weeks | N Open Seats | View Books | instructor"
 *       p: "August 24 - December 11, 2026 | Online | Distance Learning" (or time/days for in-person)
 *
 * Usage:
 *   npx tsx scripts/wi/scrape-cvtc.ts              # all departments, all current terms
 *   npx tsx scripts/wi/scrape-cvtc.ts --term "2026 Fall"
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "chippewa-valley-technical-college";
const STATE = "wi";
const BASE_URL = "https://coursesearch.cvtc.edu/";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

// All department codes from the CVTC course search dropdown
const DEPARTMENTS = [
  "ACAD", "ACCT", "AEST", "AGRI", "HVAC", "ARCT", "ABDY", "ELMC", "AMNT",
  "COSM", "MGMT", "BUS", "CHLD", "CRIM", "CULA", "DNTL", "DMS", "DESL",
  "DRNE", "EPD", "ELEC", "EMS", "COMM", "ENVR", "FARM", "FMED", "FIRE",
  "FORL", "FOTE", "GASU", "GRPH", "HIT", "HR", "BSCE", "CYBR", "DATA",
  "DESK", "PROG", "NETW", "HORT", "LEGL", "LES", "SCIL", "MACH", "ENGR",
  "MKTG", "MASG", "MATH", "MDES", "INDS", "MEDI", "CLT", "MOPP", "MOTR",
  "NURS", "SUPV", "PMED", "SCI", "PT", "PLMB", "PCOM", "QUAL", "RAD",
  "WOOD", "RESP", "STMF", "AODA", "SUPL", "SURG", "TRAF", "TRCK", "WELD",
  "SFTY",
];

// Active terms on the site
const TERMS = ["2026 Spring", "2026 Summer", "2026 Fall"];

// Current year — drop sections whose end date is in a past year
const CURRENT_YEAR = new Date().getFullYear();

function termToCode(term: string): string {
  const m = term.match(/^(\d{4})\s+(Spring|Summer|Fall)$/i);
  if (!m) return term.replace(/\s+/g, "");
  const [, year, season] = m;
  switch (season.toLowerCase()) {
    case "spring": return `${year}SP`;
    case "summer": return `${year}SU`;
    case "fall": return `${year}FA`;
    default: return `${year}XX`;
  }
}

interface CourseSection {
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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// Parse "August 24 - December 11, 2026" → "2026-08-24", "2026-12-11"
function parseDateRange(raw: string): { start: string; end: string } {
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  // "August 24 - December 11, 2026" or "August 24 - October 15, 2026"
  const m = raw.match(
    /(\w+)\s+(\d+)\s*[-–]\s*(\w+)\s+(\d+),?\s*(\d{4})/i
  );
  if (!m) return { start: "", end: "" };
  const [, startMon, startDay, endMon, endDay, year] = m;
  const sm = months[startMon.toLowerCase()] ?? "";
  const em = months[endMon.toLowerCase()] ?? "";
  if (!sm || !em) return { start: "", end: "" };
  return {
    start: `${year}-${sm}-${startDay.padStart(2, "0")}`,
    end: `${year}-${em}-${endDay.padStart(2, "0")}`,
  };
}

// Parse time: "12:30 – 2:25 p.m." or "8:30 – 9:45 a.m."
function parseTimeRange(raw: string): { start: string; end: string } {
  // Normalize different dash characters and nbsp
  const normalized = raw.replace(/\s*[–—-]\s*/g, " - ").replace(/ /g, " ");
  const m = normalized.match(/(\d{1,2}:\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s*-\s*(\d{1,2}:\d{2})\s*(a\.?m\.?|p\.?m\.?)/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1] + " " + (m[2] ?? m[4] ?? ""), end: m[3] + " " + (m[4] ?? "") };
}

// Parse day letters from span.days elements: <span class="on">M</span> etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDays($: cheerio.CheerioAPI, el: any): string {
  const daySpans = $(el).find("span.days span.on");
  if (daySpans.length === 0) return "";
  return daySpans
    .toArray()
    .map((s) => $(s).text().trim())
    .join("");
}

function inferMode(deliveryText: string, locationText: string): "in-person" | "online" | "hybrid" {
  const d = deliveryText.toLowerCase();
  const l = locationText.toLowerCase();
  if (d.includes("hybrid") || l.includes("hybrid")) return "hybrid";
  if (d.includes("online") || l.includes("online") || l.includes("distance")) return "online";
  return "in-person";
}

async function fetchDepartment(term: string, dept: string): Promise<CourseSection[]> {
  const params = new URLSearchParams({
    action: "search",
    title: "",
    term,
    subject_num: "",
    course_num: "",
    section_num: "",
    method: "",
    program: "",
    department: dept,
    submit: "Search",
  });

  let response: Response;
  try {
    response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (compatible; CommunityCollegePath/1.0)",
        "Accept": "text/html",
      },
      body: params.toString(),
    });
  } catch (err) {
    console.warn(`  [${dept}] fetch error: ${(err as Error).message}`);
    return [];
  }

  if (!response.ok) {
    console.warn(`  [${dept}] HTTP ${response.status}`);
    return [];
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];
  const termCode = termToCode(term);

  // Courses: h3.mb-1 followed by credits p and div.course-info
  $("h3.mb-1").each((_, h3El) => {
    const h3 = $(h3El);

    // Title: "804-113 | College Technical Math 1A" (span contains " | ")
    const linkEl = h3.find("a");
    // Get raw text — the span contains " | " so link text is "804-113 | College Technical Math 1A"
    const rawTitle = linkEl.text().replace(/\s+/g, " ").trim();
    const pipeIdx = rawTitle.indexOf("|");
    if (pipeIdx === -1) return;

    const rawCode = rawTitle.slice(0, pipeIdx).trim(); // "804-113"
    const courseTitle = rawTitle.slice(pipeIdx + 1).trim(); // "College Technical Math 1A"

    // Extract numeric portions of course code
    const codeMatch = rawCode.match(/^(\d+)-(\d+)/);
    if (!codeMatch) return;
    const [, deptNum, courseNum] = codeMatch;

    // Credits: next sibling p "3 Credits | Learn More"
    const creditsEl = h3.next("p");
    const creditsText = creditsEl.text().replace(/ /g, " ").trim();
    const creditsMatch = creditsText.match(/^(\d+)\s*Credits?/i);
    const credits = creditsMatch ? parseInt(creditsMatch[1], 10) : 0;

    // Skip non-credit courses
    if (credits === 0) return;

    // Sections: div.course-info > div (each div is one section)
    const courseInfoDiv = h3.nextAll("div.course-info").first();
    courseInfoDiv.find("> div").each((_, divEl) => {
      const sectionDiv = $(divEl);
      const paragraphs = sectionDiv.find("> p");

      if (paragraphs.length < 1) return;

      // First p: section/CRN info
      const sectionP = $(paragraphs[0]);
      const sectionText = sectionP.text().replace(/ /g, " ").trim();

      // Pattern: "Section #002 | CRN: 12469 | $516.15 | 16 Weeks | 26 Open Seats | [View Books | ] Nick Jakusz"
      const sectionMatch = sectionText.match(
        /Section #(\w+)\s*\|\s*CRN:\s*(\d+)\s*\|\s*\$?([\d,\.]+)\s*\|\s*\d+\s*Weeks\s*\|\s*(\d+)\s*Open Seats/i
      );
      if (!sectionMatch) return;

      const [, sectionNum, crn, , seatsOpenStr] = sectionMatch;
      const seatsOpen = parseInt(seatsOpenStr, 10);

      // Instructor: last pipe-delimited segment after "Open Seats | [View Books |]"
      // Remove HTML anchor text "View Books" if present
      const afterSeats = sectionText.replace(/.*Open Seats\s*\|\s*/i, "").trim();
      // Could be "View Books | Nick Jakusz" or just "Nick Jakusz"
      const instructor = afterSeats
        .replace(/^View\s*Books\s*\|\s*/i, "")
        .trim() || null;

      // Second p: date/time/location info
      let startDate = "";
      let endDate = "";
      let startTime = "";
      let endTime = "";
      let days = "";
      let location = "";
      let deliveryText = "";
      let mode: "in-person" | "online" | "hybrid" = "in-person";

      if (paragraphs.length >= 2) {
        const infoP = $(paragraphs[1]);
        const infoText = infoP.text().replace(/ /g, " ").replace(/\s+/g, " ").trim();

        // "August 24 - December 11, 2026 | 12:30 – 2:25 p.m. [days] | Location"
        // or "August 24 - December 11, 2026 | Online | Distance Learning"
        const parts = infoText.split("|").map((p) => p.trim());

        if (parts.length >= 1) {
          const dateRange = parseDateRange(parts[0]);
          startDate = dateRange.start;
          endDate = dateRange.end;
        }

        if (parts.length >= 2) {
          const timePart = parts[1];
          const timeRange = parseTimeRange(timePart);
          startTime = timeRange.start;
          endTime = timeRange.end;
          // Days are in span.days inside the second p
          days = parseDays($, infoP);

          if (!startTime) {
            // Could be "Online" or similar
            deliveryText = timePart;
          }
        }

        if (parts.length >= 3) {
          location = parts[2];
          deliveryText = parts.slice(2).join(" | ");
        }

        mode = inferMode(deliveryText, location);
      }

      // Determine end year from date range; skip sections that ended in a past year
      if (endDate) {
        const endYear = parseInt(endDate.slice(0, 4), 10);
        if (endYear < CURRENT_YEAR) return;
      }

      sections.push({
        college_code: SLUG,
        term: termCode,
        course_prefix: dept,
        course_number: `${deptNum}-${courseNum}`,
        course_title: courseTitle,
        credits,
        crn,
        section: sectionNum,
        days,
        start_time: startTime,
        end_time: endTime,
        start_date: startDate,
        end_date: endDate,
        location,
        campus: "CVTC",
        mode,
        instructor,
        seats_open: seatsOpen,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    });
  });

  return sections;
}

async function scrapeAll(termsToScrape: string[]): Promise<void> {
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  for (const term of termsToScrape) {
    const termCode = termToCode(term);
    console.log(`\n=== Term: ${term} (${termCode}) ===`);

    const allSections: CourseSection[] = [];

    for (const dept of DEPARTMENTS) {
      process.stdout.write(`  ${dept}...`);
      try {
        const sections = await fetchDepartment(term, dept);
        allSections.push(...sections);
        process.stdout.write(` ${sections.length}\n`);
      } catch (err) {
        console.warn(`\n  [${dept}] Error: ${(err as Error).message}`);
      }
      // Polite delay
      await new Promise((r) => setTimeout(r, 250));
    }

    const outPath = path.join(COURSES_DIR, `${termCode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(allSections, null, 2));
    console.log(`\n  → ${allSections.length} sections written to ${outPath}`);
  }
}

const args = process.argv.slice(2);
const termIdx = args.indexOf("--term");
const termArg = termIdx !== -1 ? args[termIdx + 1] : null;

const termsToRun = termArg ? [termArg] : TERMS;

scrapeAll(termsToRun).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
