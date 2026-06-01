/**
 * scrape-southeastern.ts
 *
 * Scrapes course data from Southeastern Community College's static HTML schedule files.
 * Southeastern publishes tables at:
 *   https://sccnc.edu/course-schedules/CUsectionlist_{term}_data.html
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-southeastern.ts
 *   npx tsx scripts/nc/scrape-southeastern.ts --term 2026SU
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

const COLLEGE_SLUG = "southeastern";
const BASE_URL = "https://sccnc.edu/course-schedules";
const OUTPUT_DIR = path.resolve(__dirname, "../../data/nc/courses/southeastern");

// Term URLs — Southeastern uses _su_data, _fa_data, etc. for current terms
// They also have evening/online variants (_eosu_data, _eofa_data) but we use the main ones
const TERMS: Record<string, string[]> = {
  "2026SU": ["CUsectionlist_su_data.html", "CUsectionlist_eosu_data.html"],
  "2026FA": ["CUsectionlist_fa_data.html", "CUsectionlist_eofa_data.html"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDate(raw: string): string {
  // Convert M/D/YYYY to YYYY-MM-DD
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, m, d, y] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Also try "Sep 11, 2025" format
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const longMatch = raw.match(/(\w{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (longMatch) {
    const mon = months[longMatch[1].toLowerCase()];
    if (mon) return `${longMatch[3]}-${mon}-${longMatch[2].padStart(2, "0")}`;
  }
  return "";
}

function determineMode(type: string, method: string): CourseMode {
  const t = type.toLowerCase();
  const m = method.toLowerCase();

  if (t === "internet" || m === "olab") return "online";
  if (t === "blended" || t === "hybrid") return "hybrid";
  if (m.includes("zoom")) return "zoom";
  return "in-person";
}

function parseSection(sectionName: string): { prefix: string; number: string; section: string } | null {
  // e.g. "ACA-122-I40" -> prefix: "ACA", number: "122", section: "I40"
  const match = sectionName.match(/^([A-Z]{2,4})-(\d{2,4}[A-Z]?)-(.+)$/);
  if (match) {
    return { prefix: match[1], number: match[2], section: match[3] };
  }
  return null;
}

function parseLocation(location: string): { campus: string; room: string } {
  // Location format: "CART*108" or "ONLN*COURSE" or "CART*108, ONLN*COURSE"
  if (!location || location.trim() === "") return { campus: "", room: "" };

  const parts = location.split(",").map((p) => p.trim());
  // Use the first non-online location if available
  const physical = parts.find((p) => !p.startsWith("ONLN"));
  if (physical) {
    const [building, room] = physical.split("*");
    return { campus: building || "", room: room || "" };
  }
  // All online
  return { campus: "ONL", room: "" };
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

async function scrapeFile(url: string, termCode: string): Promise<CourseSection[]> {
  console.log(`  Fetching ${url} ...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`    HTTP ${res.status} — skipping`);
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const rows = $("table tr");
  console.log(`    Found ${rows.length} rows (including header)`);

  const sections: CourseSection[] = [];

  // Column order: Section Name, Title, Type, Credits, Start Date, End Date,
  // Days, Method, Start Time, End Time, Location, Faculty Name, Capacity,
  // Seats Left, Status, Additional Information, 10% Census Dates, Sec Reporting Term
  rows.each((i, row) => {
    if (i === 0) return; // skip header

    const cells = $(row).find("td");
    if (cells.length < 14) return;

    const getText = (idx: number) => $(cells[idx]).text().trim();

    const sectionName = getText(0);
    const title = getText(1);
    const type = getText(2); // "Traditional", "Internet", "Blended"
    const credits = getText(3);
    const startDate = getText(4);
    // const endDate = getText(5);
    const days = getText(6);
    const method = getText(7); // "LEC", "LAB", "OLAB"
    const startTime = getText(8);
    const endTime = getText(9);
    const location = getText(10);
    const faculty = getText(11);
    const capacity = getText(12);
    const seatsLeft = getText(13);
    // const status = getText(14); // "Open" / "Closed"

    const parsed = parseSection(sectionName);
    if (!parsed) return;

    const loc = parseLocation(location);
    const mode = determineMode(type, method);

    const seatsTotal = parseInt(capacity, 10);
    const seatsOpen = parseInt(seatsLeft, 10);

    sections.push({
      college_code: COLLEGE_SLUG,
      term: termCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits: isNaN(parseFloat(credits)) ? 0 : parseFloat(credits),
      crn: `${parsed.prefix}${parsed.number}-${parsed.section}`,
      days: days || "",
      start_time: startTime || "",
      end_time: endTime || "",
      start_date: normalizeDate(startDate),
      location: loc.room ? `${loc.campus} ${loc.room}`.trim() : "",
      campus: mode === "online" ? "ONL" : loc.campus,
      mode,
      instructor: faculty || null,
      seats_open: isNaN(seatsOpen) ? null : seatsOpen,
      seats_total: isNaN(seatsTotal) ? null : seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  console.log(`    Parsed ${sections.length} sections`);
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

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalSections = 0;

  for (const [termCode, files] of Object.entries(termsToScrape)) {
    if (!files) continue;
    console.log(`\nScraping ${termCode}...`);

    // Merge sections from all files for this term (main + evening/online)
    const allSections: CourseSection[] = [];
    const seenKeys = new Set<string>();

    for (const file of files) {
      const url = `${BASE_URL}/${file}`;
      const sections = await scrapeFile(url, termCode);

      // Deduplicate by section name (same section may appear in both main and evening files)
      for (const s of sections) {
        const key = `${s.course_prefix}-${s.course_number}-${s.crn}-${s.days}-${s.start_time}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allSections.push(s);
        }
      }
    }

    if (allSections.length > 0) {
      const outPath = path.join(OUTPUT_DIR, `${termCode}.json`);
      fs.writeFileSync(outPath, JSON.stringify(allSections, null, 2));
      console.log(`  Wrote ${allSections.length} sections to ${outPath}`);
      totalSections += allSections.length;
    }
  }

  console.log(`\nDone! Total: ${totalSections} sections scraped for Southeastern.`);
}

main().catch(console.error);
