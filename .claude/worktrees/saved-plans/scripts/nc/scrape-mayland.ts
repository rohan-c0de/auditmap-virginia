/**
 * scrape-mayland.ts
 *
 * Scrapes course data from Mayland Community College's static HTML schedule files.
 * Mayland publishes schedule tables at predictable URLs:
 *   https://www.mayland.edu/wp-content/uploads/ScheduleFiles/{termCode}-sched.html
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-mayland.ts
 *   npx tsx scripts/nc/scrape-mayland.ts --term 2026SU
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Types (matching lib/types.ts CourseSection)
// ---------------------------------------------------------------------------

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
// Config
// ---------------------------------------------------------------------------

const COLLEGE_SLUG = "mayland";
const BASE_URL = "https://www.mayland.edu/wp-content/uploads/ScheduleFiles";
const OUTPUT_DIR = path.resolve(__dirname, "../../data/nc/courses/mayland");

// Term codes to scrape — use the "all courses" file for each term
const TERMS: Record<string, string> = {
  "2026SP": "2026SP-sched.html",
  "2026SU": "2026SU-sched.html",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDate(raw: string): string {
  // Convert MM/DD/YYYY to YYYY-MM-DD
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, m, d, y] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

function determineMode(method: string, building: string, comments: string): CourseMode {
  const m = method.toLowerCase();
  const b = building.toLowerCase();
  const c = comments.toLowerCase();

  if (m === "olab" || b === "online" || c.includes("online instruction")) {
    if (c.includes("hybrid") || c.includes("blended") || c.includes("50%")) {
      return "hybrid";
    }
    return "online";
  }
  if (c.includes("hybrid") || c.includes("blended")) return "hybrid";
  if (c.includes("zoom")) return "zoom";
  return "in-person";
}

function extractStartDate(comments: string): string {
  // Look for patterns like "opens on 01/05/2026" or "Opens 01/05/2026" or "Starts 01/05/2026"
  const match = comments.match(/(?:opens?|starts?|begins?)\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (match) return normalizeDate(match[1]);
  // Also try standalone date
  const dateMatch = comments.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) return normalizeDate(dateMatch[1]);
  return "";
}

function parseSection(sectionName: string): { prefix: string; number: string; section: string } | null {
  // e.g. "ACA-115-E195" -> prefix: "ACA", number: "115", section: "E195"
  // e.g. "BIO-110-Y50" -> prefix: "BIO", number: "110", section: "Y50"
  const match = sectionName.match(/^([A-Z]{2,4})-(\d{2,4}[A-Z]?)-(.+)$/);
  if (match) {
    return { prefix: match[1], number: match[2], section: match[3] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

async function scrapeTerm(termCode: string, fileName: string): Promise<CourseSection[]> {
  const url = `${BASE_URL}/${fileName}`;
  console.log(`\nFetching ${url} ...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  HTTP ${res.status} — skipping ${termCode}`);
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Find the data table (third table on the page — first two are title/header)
  const tables = $("table");
  if (tables.length < 3) {
    console.error(`  Expected 3+ tables, found ${tables.length} — skipping`);
    return [];
  }

  const dataTable = tables.eq(2);
  const rows = dataTable.find("tr");
  console.log(`  Found ${rows.length} rows (including header)`);

  const sections: CourseSection[] = [];

  // Skip header row (index 0)
  rows.each((i, row) => {
    if (i === 0) return; // skip header

    const cells = $(row).find("td");
    if (cells.length < 13) return; // skip malformed rows

    const getText = (idx: number) => $(cells[idx]).text().trim();

    const sectionName = getText(0);
    const title = getText(1);
    const synonym = getText(2); // CRN
    const credits = getText(3);
    const capacity = getText(4);
    const available = getText(5);
    const building = getText(6);
    const room = getText(7);
    const method = getText(8);
    const days = getText(9).replace(/&nbsp;/g, "").trim();
    const startTime = getText(10).replace(/&nbsp;/g, "").trim();
    const endTime = getText(11).replace(/&nbsp;/g, "").trim();
    const instructor = getText(12);
    // Index 13 is Link (textbook), index 14 is Comments
    const comments = cells.length > 14 ? getText(14) : "";

    const parsed = parseSection(sectionName);
    if (!parsed) return;

    const startDate = extractStartDate(comments);
    const mode = determineMode(method, building, comments);

    const seatsTotal = parseInt(capacity, 10);
    const seatsAvailable = parseInt(available, 10);

    sections.push({
      college_code: COLLEGE_SLUG,
      term: termCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits: isNaN(parseFloat(credits)) ? 0 : parseFloat(credits),
      crn: synonym || `${parsed.prefix}${parsed.number}-${parsed.section}`,
      days: days === "\u00a0" || days === "" ? "" : days.replace(/,\s*/g, " "),
      start_time: startTime === "\u00a0" || startTime === "" ? "" : startTime,
      end_time: endTime === "\u00a0" || endTime === "" ? "" : endTime,
      start_date: startDate,
      location: room && room !== "ONLINE" ? `${building} ${room}`.trim() : "",
      campus: building === "Online" ? "ONL" : building || "",
      mode,
      instructor: instructor && instructor !== "\u00a0" ? instructor : null,
      seats_open: isNaN(seatsAvailable) ? null : seatsAvailable,
      seats_total: isNaN(seatsTotal) ? null : seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  console.log(`  Parsed ${sections.length} course sections for ${termCode}`);
  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termArg = args.find((a) => a.startsWith("--term"))
    ? args[args.indexOf("--term") + 1]
    : null;

  const termsToScrape = termArg
    ? { [termArg]: TERMS[termArg] }
    : TERMS;

  if (termArg && !TERMS[termArg]) {
    console.error(`Unknown term: ${termArg}. Available: ${Object.keys(TERMS).join(", ")}`);
    process.exit(1);
  }

  // Ensure output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalSections = 0;

  for (const [termCode, fileName] of Object.entries(termsToScrape)) {
    const sections = await scrapeTerm(termCode, fileName);

    if (sections.length > 0) {
      const outPath = path.join(OUTPUT_DIR, `${termCode}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
      console.log(`  Wrote ${sections.length} sections to ${outPath}`);
      totalSections += sections.length;
    }
  }

  console.log(`\nDone! Total: ${totalSections} sections scraped for Mayland.`);
}

main().catch(console.error);
