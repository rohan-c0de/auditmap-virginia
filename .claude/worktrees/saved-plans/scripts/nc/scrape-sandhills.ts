/**
 * Scrape Sandhills Community College from their public "Seats Available" HTML pages.
 *
 * Source: https://olympus.sandhills.edu/seatsAvailable/
 * URL pattern: {term}SeatsAvailable.htm (e.g., 2026SPSeatsAvailable.htm)
 *
 * Columns: Dept, Num, Sec, Title, MeetingDay, Time, Location, Instructors, Cred Hrs, Max Seats, Remaining Seats, Comments
 * Some courses span multiple rows (continuation rows have empty Dept/Num).
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-sandhills.ts
 *   npx tsx scripts/nc/scrape-sandhills.ts --term 2026SU
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
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const COLLEGE_CODE = "sandhills";
const BASE_URL = "https://olympus.sandhills.edu/seatsAvailable";

function expandDays(raw: string): string {
  if (!raw) return "";
  const days: string[] = [];
  let i = 0;
  const s = raw.toUpperCase().replace(/\s/g, "");
  while (i < s.length) {
    if (s[i] === "T" && s[i + 1] === "H") { days.push("Th"); i += 2; }
    else if (s[i] === "S" && s[i + 1] === "S" && s[i + 2] === "U") { days.push("Su"); i += 3; }
    else if (s[i] === "S" && s[i + 1] === "U") { days.push("Su"); i += 2; }
    else if (s[i] === "S" && s[i + 1] === "A") { days.push("Sa"); i += 2; }
    else if (s[i] === "M") { days.push("M"); i++; }
    else if (s[i] === "T") { days.push("T"); i++; }
    else if (s[i] === "W") { days.push("W"); i++; }
    else if (s[i] === "F") { days.push("F"); i++; }
    else if (s[i] === "S") { days.push("Sa"); i++; }
    else { i++; }
  }
  return days.join(" ");
}

function parseTime(raw: string): { start: string; end: string } {
  if (!raw) return { start: "", end: "" };
  const m = raw.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase(), end: m[2].toUpperCase() };
}

function determineMode(location: string, days: string): string {
  const loc = location.toUpperCase();
  if (loc.includes("DIST") || loc.includes("ONLINE") || loc.includes("INTERNET")) {
    // DIST-CLAS, DIST-LAB = distance/online
    return "online";
  }
  return "in-person";
}

function parseStartDate(comments: string): string {
  // Try to extract start date from comments like "Class runs 1/12 - 3/4"
  const m = comments.match(/(?:Class runs|begins|starts)\s+(\d{1,2})\/(\d{1,2})/i);
  if (m) {
    return `2026-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

async function scrape(termCode: string): Promise<CourseSection[]> {
  const url = `${BASE_URL}/${termCode}SeatsAvailable.htm`;
  console.log(`Fetching ${url}...`);

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) {
      console.log(`  Not available (HTTP ${res.status})`);
      return [];
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  const rows = $("table tr").toArray();
  let currentSection: Partial<CourseSection> | null = null;

  for (const row of rows) {
    const tds = $(row).find("td");
    if (tds.length < 11) continue;

    const dept = $(tds[0]).text().trim();
    const num = $(tds[1]).text().trim();
    const sec = $(tds[2]).text().trim();
    const title = $(tds[3]).text().trim();
    const meetDay = $(tds[4]).text().trim();
    const timeStr = $(tds[5]).text().trim();
    const location = $(tds[6]).text().trim();
    const instructor = $(tds[7]).text().trim();
    const credits = $(tds[8]).text().trim();
    const maxSeats = $(tds[9]).text().trim();
    const remaining = $(tds[10]).text().trim();
    const comments = tds.length > 11 ? $(tds[11]).text().trim() : "";

    if (dept && num) {
      // New course section
      if (currentSection && currentSection.course_prefix) {
        sections.push(currentSection as CourseSection);
      }

      const days = expandDays(meetDay);
      const { start, end } = parseTime(timeStr);
      const mode = determineMode(location, days);

      currentSection = {
        college_code: COLLEGE_CODE,
        term: termCode,
        course_prefix: dept,
        course_number: num,
        course_title: title,
        credits: isNaN(parseInt(credits, 10)) ? 0 : parseInt(credits, 10),
        crn: `${dept}-${num}-${sec}`,
        days: mode === "online" && !start ? "M T W Th F Sa Su" : days,
        start_time: start,
        end_time: end,
        start_date: parseStartDate(comments),
        location: mode === "online" ? "Online" : location,
        campus: location.split("-")[0] || "",
        mode,
        instructor,
        seats_open: isNaN(parseInt(remaining, 10)) ? null : parseInt(remaining, 10),
        seats_total: isNaN(parseInt(maxSeats, 10)) ? null : parseInt(maxSeats, 10),
        prerequisite_text: null,
        prerequisite_courses: [],
      };
    } else if (currentSection && (meetDay || timeStr || location)) {
      // Continuation row — additional meeting info
      // If current section is in-person and this is an online meeting, mark as hybrid
      const contMode = determineMode(location, meetDay);
      if (contMode === "online" && currentSection.mode === "in-person") {
        currentSection.mode = "hybrid";
      } else if (contMode !== "online" && currentSection.mode === "online") {
        currentSection.mode = "hybrid";
        // Update days/times from the in-person meeting
        const days = expandDays(meetDay);
        const { start, end } = parseTime(timeStr);
        if (days) currentSection.days = days;
        if (start) currentSection.start_time = start;
        if (end) currentSection.end_time = end;
        if (location) currentSection.location = location;
      }
    }
  }

  // Push last section
  if (currentSection && currentSection.course_prefix) {
    sections.push(currentSection as CourseSection);
  }

  return sections;
}

async function main() {
  const termIdx = process.argv.indexOf("--term");
  const term = termIdx >= 0 ? process.argv[termIdx + 1] : "2026SP";

  console.log(`Sandhills Community College Seats Available Scraper`);
  console.log(`Term: ${term}\n`);

  const sections = await scrape(term);
  console.log(`\nParsed ${sections.length} sections`);

  if (sections.length === 0) return;

  const prefixes = new Set(sections.map((s) => s.course_prefix));
  const modes = { "in-person": 0, online: 0, hybrid: 0 };
  sections.forEach((s) => modes[s.mode as keyof typeof modes]++);
  console.log(`  Subject areas: ${prefixes.size}`);
  console.log(`  In-person: ${modes["in-person"]}, Online: ${modes.online}, Hybrid: ${modes.hybrid}`);

  const eng111 = sections.filter((s) => s.course_prefix === "ENG" && s.course_number === "111");
  if (eng111.length) {
    console.log(`\n  Spot check — ENG 111: ${eng111.length} sections`);
    eng111.slice(0, 3).forEach((s) =>
      console.log(`    ${s.crn}: ${s.days} ${s.start_time}-${s.end_time} (${s.mode}) ${s.instructor} [${s.seats_open}/${s.seats_total}]`)
    );
  }

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
