/**
 * scrape-midlands.ts
 *
 * Scrapes course section data from Midlands Technical College, which uses
 * a custom Java-based course search (not Colleague or Banner).
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-midlands.ts
 *   npx tsx scripts/sc/scrape-midlands.ts --term "Fall 2026"
 */

// Midlands Tech's SSL cert may not be trusted by Node — allow it
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://mtconline.midlandstech.edu/mtcacsearch";
const COLLEGE_SLUG = "midlands";
const DELAY_MS = 500;

// All 75 subject codes at Midlands Tech
const SUBJECTS = [
  "ACC", "ACR", "AET", "AHS", "AMT", "ANT", "AOT", "ART", "ARV", "ASL",
  "AST", "AUT", "BAF", "BCT", "BIO", "BUS", "CET", "CGC", "CHM", "COL",
  "CPT", "CRJ", "CWE", "DAT", "DHG", "ECD", "ECE", "ECO", "EDU", "EEM",
  "EET", "EGR", "EGT", "EMS", "ENG", "EVE", "GEO", "HIS", "HSM", "HUS",
  "IDS", "IMT", "IST", "ITP", "LEG", "LNG", "MAT", "MEC", "MED", "MET",
  "MGT", "MKT", "MLT", "MTT", "MUS", "NMT", "NUR", "PHI", "PHM", "PHY",
  "PSC", "PSY", "PTH", "RAD", "RDG", "REL", "RES", "RWR", "SAC", "SOC",
  "SPA", "SPC", "SUR", "THE", "WLD",
];

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

/** Map term name to MTC term code */
function getTermCode(termName: string): string {
  const yearMatch = termName.match(/(\d{4})/);
  const seasonMatch = termName.match(/(spring|summer|fall|winter)/i);
  if (!yearMatch || !seasonMatch) return termName;

  const year = yearMatch[1];
  const season = seasonMatch[1].toLowerCase();
  const seasonCodes: Record<string, string> = {
    spring: "SP", summer: "SU", fall: "FA", winter: "WI",
  };
  // Use the "All Sessions" code (e.g., FAR2026) to get all sub-terms
  return `${seasonCodes[season]}R${year}`;
}

/** Normalize term code for file output (e.g., "FAR2026" → "2026FA", "2026SP" stays) */
function normalizeTermCode(termCode: string): string {
  // "SPR2026" → "2026SP", "SUR2026" → "2026SU", "FAR2026" → "2026FA"
  const match = termCode.match(/^(SP|SU|FA)R(\d{4})$/);
  if (match) return `${match[2]}${match[1]}`;
  // Already normalized like "2026FA"
  return termCode.replace(/^(\d{4}(?:SP|SU|FA)).*$/, "$1");
}

function determineMode(campusText: string, meetingText: string): CourseMode {
  const campus = campusText.toLowerCase();
  const meeting = meetingText.toLowerCase();

  if (meeting.includes("hybrid") || campus.includes("hybrid")) return "hybrid";
  if (campus.includes("online") || meeting.includes("online lecture") || meeting.includes("online lab")) {
    return "online";
  }
  if (campus.includes("virtual") || campus.includes("synchronous")) return "zoom";
  return "in-person";
}

function parseDays(meetingText: string): string {
  // Extract day patterns from meeting text
  // e.g., "08/25/2026 - 12/10/2026 Lecture M W 09:25AM - 10:40AM"
  const dayMap: Record<string, string> = {
    " M ": "M", " T ": "Tu", " W ": "W", " TH ": "Th", " F ": "F", " S ": "Sa", " SU ": "Su",
  };
  const days: string[] = [];
  const padded = ` ${meetingText.toUpperCase()} `;
  if (padded.includes(" M ")) days.push("M");
  if (padded.includes(" T ") && !padded.includes(" TH ")) days.push("Tu");
  if (padded.includes(" TH ")) days.push("Th");
  if (padded.includes(" W ")) days.push("W");
  if (padded.includes(" F ")) days.push("F");
  if (padded.includes(" S ") && !padded.includes(" SU ")) days.push("Sa");
  if (padded.includes(" SU ")) days.push("Su");
  return days.join(" ");
}

function parseTimes(meetingText: string): { start: string; end: string } {
  // Extract time range like "09:25AM - 10:40AM" or "6:00PM - 9:30PM"
  const timeMatch = meetingText.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!timeMatch) return { start: "", end: "" };
  return { start: timeMatch[1].trim(), end: timeMatch[2].trim() };
}

function parseStartDate(meetingText: string): string {
  // Extract start date like "08/25/2026"
  const dateMatch = meetingText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!dateMatch) return "";
  return `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

async function scrapeSubjects(
  termCode: string,
  subjects: string[]
): Promise<CourseSection[]> {
  const allSections: CourseSection[] = [];

  // Batch subjects 5 at a time (the form supports Subject0-Subject4)
  for (let i = 0; i < subjects.length; i += 5) {
    const batch = subjects.slice(i, i + 5);
    process.stdout.write(
      `  [${Math.min(i + 5, subjects.length)}/${subjects.length}] ${batch.join(", ").padEnd(25)} `
    );

    const formData = new URLSearchParams();
    formData.set("Term", termCode);
    for (let j = 0; j < 5; j++) {
      formData.set(`Subject${j}`, batch[j] || "");
      formData.set(`CourseNum${j}`, "");
      formData.set(`SectNum${j}`, "");
    }
    formData.set("StartTime", " ");
    formData.set("EndTime", " ");
    formData.set("TitleKeywords", "");
    formData.set("InstLastName", "");
    formData.set("btnSubmit2", "Submit");

    try {
      const resp = await fetch(`${BASE_URL}/catalogsearch`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const html = await resp.text();
      const sections = parseResultsHtml(html, termCode);
      allSections.push(...sections);
      console.log(`${sections.length} sections`);
    } catch (e) {
      console.error(`error: ${e}`);
    }

    await sleep(DELAY_MS);
  }

  return allSections;
}

function parseResultsHtml(html: string, termCode: string): CourseSection[] {
  const sections: CourseSection[] = [];

  // Find all table rows (skip header row)
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch;
  let rowIndex = 0;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];

    // Extract all <td> cells
    const tds: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tds.push(tdMatch[1].trim());
    }

    // Skip header rows or rows with wrong number of columns
    if (tds.length < 7) continue;
    rowIndex++;

    // Column 2: Course Section — link text like "ENG-101-A01 (322710) English Comp I"
    const courseCell = stripHtml(tds[2]);
    const courseMatch = courseCell.match(/^([A-Z]{2,4})-(\d{3,4}[A-Z]*)-([A-Z0-9]+)\s+\((\d+)\)\s+(.+)$/);
    if (!courseMatch) continue;

    const [, prefix, number, section, crn, title] = courseMatch;

    // Column 1: Campus
    const campusText = stripHtml(tds[1]);

    // Column 3: Meeting info (may contain multiple lines)
    const meetingText = stripHtml(tds[3]);

    // Column 4: Status (Open/Closed)
    // Column 5: Available seats
    // Column 6: Credits
    const credits = parseFloat(stripHtml(tds[6])) || 0;

    // Column 7: Faculty
    const instructor = stripHtml(tds[7]) || null;

    // Parse meeting details
    const days = parseDays(meetingText);
    const times = parseTimes(meetingText);
    const startDate = parseStartDate(meetingText);
    const mode = determineMode(campusText, meetingText);

    // Normalize the term code for output
    const normalizedTerm = normalizeTermCode(termCode);

    // Determine campus code
    let campus = "";
    if (campusText.includes("Airport")) campus = "Airport";
    else if (campusText.includes("Beltline")) campus = "Beltline";
    else if (campusText.includes("Northeast")) campus = "Northeast";
    else if (campusText.includes("Fairfield")) campus = "Fairfield";
    else if (campusText.includes("Fort Jackson")) campus = "Fort Jackson";
    else if (campusText.includes("Online")) campus = "Online";
    else if (campusText.includes("Virtual")) campus = "Virtual";
    else campus = campusText;

    sections.push({
      college_code: COLLEGE_SLUG,
      term: normalizedTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn,
      days,
      start_time: times.start,
      end_time: times.end,
      start_date: startDate,
      location: campusText,
      campus,
      mode,
      instructor,
      seats_open: null, // Would need separate fetch per section
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const termFlag = args.indexOf("--term");
  const termName = termFlag >= 0 ? args[termFlag + 1] : "Summer 2026";

  const termCode = getTermCode(termName);
  const normalizedTerm = normalizeTermCode(termCode);

  console.log(`Scraping Midlands Technical College for ${termName} (term code: ${termCode})...\n`);

  const sections = await scrapeSubjects(termCode, SUBJECTS);

  if (sections.length > 0) {
    const outDir = path.join(process.cwd(), "data", "sc", "courses", COLLEGE_SLUG);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${normalizedTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`\nWritten ${sections.length} sections to ${outPath}`);
  } else {
    console.log(`\nNo sections found for ${termName}`);
  }

  // Auto-import into Supabase (skip with --no-import)
  const cliArgs = process.argv.slice(2);
  if (!cliArgs.includes("--no-import")) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("sc");
  }

  console.log("Done.");
}

main().catch(console.error);
