/**
 * Scrape College of The Albemarle course schedule from static HTML on S3.
 *
 * Source: https://coa-class-schedules.s3.us-east-1.amazonaws.com/{term}.HTML
 * Terms: 2026SP.HTML, 2026SU.HTML, 2026FA.HTML (may not all exist)
 *
 * The page is a flat HTML table with one row per section. The "Course" column
 * packs prefix-number-section, credits, contact hours, title, and dates into
 * one cell, e.g.:
 *   "ACA-111-IN01 (1, 1) College Student Success 1/8/2026 - 3/9/2026"
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-albemarle.ts
 *   npx tsx scripts/nc/scrape-albemarle.ts --term 2026SU
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

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
  instructor: string;
  seats_open: number;
  seats_total: number;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const S3_BASE = "https://coa-class-schedules.s3.us-east-1.amazonaws.com";
const COLLEGE_CODE = "college-of-the-albemarle";

function parseTermFile(termCode: string): string {
  // Map our term codes to their file names
  // 2026SP → 2026SP, 2026SU → 2026SU, 2026FA → 2026FA
  return `${termCode}.HTML`;
}

function parseDays(dayStr: string): string {
  // Input: "MWF", "T 11:30am - 12:20pm", "MTWTHF", "MW", "TTH"
  // We only want the day letters, not times
  const clean = dayStr.replace(/\d.*/g, "").trim();
  if (!clean) return "";

  // Expand day abbreviations
  const days: string[] = [];
  let i = 0;
  const s = clean.toUpperCase();
  while (i < s.length) {
    if (s[i] === "T" && s[i + 1] === "H") {
      days.push("Th");
      i += 2;
    } else if (s[i] === "M") {
      days.push("M");
      i++;
    } else if (s[i] === "T") {
      days.push("T");
      i++;
    } else if (s[i] === "W") {
      days.push("W");
      i++;
    } else if (s[i] === "F") {
      days.push("F");
      i++;
    } else if (s[i] === "S" && s[i + 1] === "A") {
      days.push("Sa");
      i += 2;
    } else if (s[i] === "S" && s[i + 1] === "U") {
      days.push("Su");
      i += 2;
    } else if (s[i] === "S") {
      days.push("Sa");
      i++;
    } else {
      i++;
    }
  }
  return days.join(" ");
}

function parseTime(timeStr: string): { start: string; end: string } {
  // Input: "T 11:30am - 12:20pm" or "MW 09:00am - 10:15am" or "MTWTHF" (no time)
  const match = timeStr.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
  if (!match) return { start: "", end: "" };

  const format = (t: string) => {
    const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if (!m) return t.trim();
    const hour = m[1].padStart(2, "0");
    return `${hour}:${m[2]} ${m[3].toUpperCase()}`;
  };

  return { start: format(match[1]), end: format(match[2]) };
}

function parseStartDate(dateRange: string): string {
  // Input: "1/8/2026 - 3/9/2026" → "2026-01-08"
  const match = dateRange.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function determineMode(location: string, days: string): string {
  const loc = location.toUpperCase();
  if (loc === "INTERNET" || loc === "ONLINE") return "online";
  if (loc.includes("INTERNET") || loc.includes("ONLINE")) return "hybrid";
  return "in-person";
}

function parseSeats(seatsStr: string): { open: number; total: number } {
  // "8/30" → { open: 22, total: 30 } — actually "enrolled/capacity"
  // So open = capacity - enrolled
  const match = seatsStr.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return { open: 0, total: 0 };
  const enrolled = parseInt(match[1]);
  const total = parseInt(match[2]);
  return { open: Math.max(0, total - enrolled), total };
}

async function scrapeAlbemarle(termCode: string): Promise<CourseSection[]> {
  const fileName = parseTermFile(termCode);
  const url = `${S3_BASE}/${fileName}`;

  console.log(`Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) {
      console.log(`  No data available for ${termCode} (HTTP ${res.status})`);
      return [];
    }
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  // Find all table rows (skip header)
  const rows = $("table tr").toArray();
  let skippedHeader = false;

  for (const row of rows) {
    const tds = $(row).find("td");
    if (tds.length === 0) {
      // This might be a header row with <th>
      skippedHeader = true;
      continue;
    }
    if (!skippedHeader) {
      skippedHeader = true;
      continue;
    }

    if (tds.length < 9) continue;

    const synText = $(tds[0]).text().trim();
    const courseCell = $(tds[1]).text().trim();
    // Columns: Syn, Course, Class Type, Meeting Location, Meeting Time, Textbook, Instructor, Refund Date, Seats

    // Parse the course cell: "ACA-111-IN01 (1, 1) College Student Success 1/8/2026 - 3/9/2026"
    const courseMatch = courseCell.match(
      /^([A-Z]{2,4})-(\d{3}[A-Z]{0,2})-(\S+)\s+\((\d+),\s*\d+\)\s+(.+?)(?:\s*-\s*Full\s*)?(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/
    );
    if (!courseMatch) continue;

    const prefix = courseMatch[1];
    const number = courseMatch[2];
    const section = courseMatch[3];
    const credits = parseInt(courseMatch[4]);
    const title = courseMatch[5].replace(/\s+$/, "").replace(/\s*-\s*$/, "").trim();
    const startDateStr = `${courseMatch[6]}`;

    const crn = `${prefix}-${number}-${section}`;

    // Class Type (may have multiple lines for multi-component sections)
    // const classType = $(tds[2]).text().trim();

    // Meeting Location — may have multiple lines
    const locationLines = $(tds[3]).html()?.split(/<br\s*\/?>/i).map(l => cheerio.load(l).text().trim()).filter(Boolean) || [];
    const location = locationLines[0] || "";

    // Meeting Time — may have multiple lines
    const timeLines = $(tds[4]).html()?.split(/<br\s*\/?>/i).map(l => cheerio.load(l).text().trim()).filter(Boolean) || [];
    const timeStr = timeLines[0] || "";

    const days = parseDays(timeStr);
    const { start, end } = parseTime(timeStr);
    const startDate = parseStartDate(startDateStr);

    // Determine mode based on all locations (may be hybrid)
    const allLocations = locationLines.join(" ");
    const hasOnline = allLocations.toUpperCase().includes("INTERNET");
    const hasInPerson = locationLines.some(l => !l.toUpperCase().includes("INTERNET") && l.length > 0);
    let mode: string;
    if (hasOnline && hasInPerson) mode = "hybrid";
    else if (hasOnline) mode = "online";
    else mode = "in-person";

    const instructor = $(tds[6]).text().trim();
    const seatsStr = $(tds[8]).text().trim();
    const { open, total } = parseSeats(seatsStr);

    sections.push({
      college_code: COLLEGE_CODE,
      term: termCode,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn,
      days,
      start_time: start,
      end_time: end,
      start_date: startDate,
      location: mode === "online" ? "Online" : location,
      campus: mode === "online" ? "ONLINE" : "MAIN",
      mode,
      instructor,
      seats_open: open,
      seats_total: total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

async function main() {
  const termArg = process.argv.find((a) => a === "--term");
  const termIdx = process.argv.indexOf("--term");
  const term = termIdx >= 0 ? process.argv[termIdx + 1] : "2026SP";

  console.log(`College of The Albemarle Schedule Scraper\n`);
  console.log(`Term: ${term}\n`);

  const sections = await scrapeAlbemarle(term);
  console.log(`\nParsed ${sections.length} sections`);

  if (sections.length === 0) {
    console.log("No sections found. Exiting.");
    return;
  }

  // Stats
  const prefixes = new Set(sections.map((s) => s.course_prefix));
  const modes = { "in-person": 0, online: 0, hybrid: 0 };
  sections.forEach((s) => modes[s.mode as keyof typeof modes]++);
  console.log(`  Subject areas: ${prefixes.size}`);
  console.log(`  In-person: ${modes["in-person"]}, Online: ${modes.online}, Hybrid: ${modes.hybrid}`);

  // Spot check
  const eng111 = sections.filter((s) => s.course_prefix === "ENG" && s.course_number === "111");
  if (eng111.length) {
    console.log(`\n  Spot check — ENG 111 sections: ${eng111.length}`);
    eng111.slice(0, 3).forEach((s) =>
      console.log(`    ${s.crn}: ${s.days} ${s.start_time}-${s.end_time} (${s.mode}) ${s.instructor} [${s.seats_open}/${s.seats_total}]`)
    );
  }

  // Write output
  const outDir = path.join(process.cwd(), "data", "nc", "courses", COLLEGE_CODE);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${term}.json`);
  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
