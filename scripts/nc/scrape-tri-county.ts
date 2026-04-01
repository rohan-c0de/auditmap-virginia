/**
 * Scrape Tri-County Community College from their PDF class schedule.
 *
 * Source: https://www.tricountycc.edu/wp-content/uploads/2026/01/Spring-2026-Schedule-v1.pdf
 * Format: text-based PDF with lines like:
 *   ACA-111-O2O1 College Student Success Radford 1 3/9/2026 5/6/2026 2nd 8wk Online
 *   ART-132-TRM1 Drawing II 8:10 AM 11:00 AM TTH Adams Y 3 1/7/2026 5/6/2026
 *
 * Uses Python/pdfplumber for text extraction.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-tri-county.ts
 */

import { execSync } from "child_process";
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

const COLLEGE_CODE = "tri-county";
const PDF_URL = "https://www.tricountycc.edu/wp-content/uploads/2026/01/Spring-2026-Schedule-v1.pdf";

function expandDays(raw: string): string {
  if (!raw) return "";
  const days: string[] = [];
  let i = 0;
  const s = raw.toUpperCase();
  while (i < s.length) {
    if (s[i] === "T" && s[i + 1] === "H") { days.push("Th"); i += 2; }
    else if (s[i] === "M") { days.push("M"); i++; }
    else if (s[i] === "T") { days.push("T"); i++; }
    else if (s[i] === "W") { days.push("W"); i++; }
    else if (s[i] === "F") { days.push("F"); i++; }
    else if (s[i] === "S") { days.push("Sa"); i++; }
    else { i++; }
  }
  return days.join(" ");
}

function parseLine(line: string): CourseSection | null {
  // Pattern: SECTION TITLE [TIME1 TIME2 DAYS] INSTRUCTOR [Y] CREDITS START_DATE END_DATE [LOCATION]
  // Examples:
  //   ACA-111-O2O1 College Student Success Radford 1 3/9/2026 5/6/2026 2nd 8wk Online
  //   ART-132-TRM1 Drawing II 8:10 AM 11:00 AM TTH Adams Y 3 1/7/2026 5/6/2026
  //   ACA-122-HRM1 College Transfer Success 3:10 PM 4:00 PM M Goebel 1 1/7/2026 5/6/2026

  const secMatch = line.match(/^([A-Z]{2,4})-(\d{3}[A-Z]?)-(\S+)\s+(.+)/);
  if (!secMatch) return null;

  const prefix = secMatch[1];
  const number = secMatch[2];
  const section = secMatch[3];
  let rest = secMatch[4];

  // Try to find times: "H:MM AM/PM H:MM AM/PM DAYS"
  const timeMatch = rest.match(/^(.+?)\s+(\d{1,2}:\d{2}\s+[AP]M)\s+(\d{1,2}:\d{2}\s+[AP]M)\s+([MTWTHFS]+)\s+(.+)$/);

  let title = "";
  let startTime = "";
  let endTime = "";
  let daysStr = "";
  let afterDays = "";

  if (timeMatch) {
    title = timeMatch[1].trim();
    startTime = timeMatch[2].replace(/\s+/g, " ");
    endTime = timeMatch[3].replace(/\s+/g, " ");
    daysStr = expandDays(timeMatch[4]);
    afterDays = timeMatch[5];
  } else {
    // No time — online or no meeting info
    // Pattern: "TITLE INSTRUCTOR [Y] CREDITS START END [LOCATION]"
    afterDays = rest;
    // Extract title: everything before the dates/instructor pattern
    // Dates are like "1/7/2026 5/6/2026"
    const dateIdx = rest.search(/\d{1,2}\/\d{1,2}\/\d{4}/);
    if (dateIdx > 0) {
      // Work backwards from date to find credits number and instructor
      const beforeDate = rest.substring(0, dateIdx).trim();
      afterDays = rest.substring(dateIdx);

      // beforeDate: "College Student Success Radford 1" or "Drawing II Adams Y 3"
      // Credits is the last number, instructor is the word before it
      const parts = beforeDate.split(/\s+/);
      const credits = parseInt(parts[parts.length - 1]);
      if (!isNaN(credits)) {
        parts.pop(); // remove credits
        // Check for prereq "Y"
        if (parts[parts.length - 1] === "Y") parts.pop();
        // Last part is instructor
        const instructor = parts.pop() || "";
        title = parts.join(" ");

        // Parse dates from afterDays
        const dates = afterDays.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})(.*)/);
        const startDate = dates ? formatDate(dates[1]) : "";
        const remaining = dates ? dates[3].trim() : "";

        // Determine mode from section code or remaining text
        const isOnline = section.includes("OR") || section.includes("O2") ||
          remaining.toLowerCase().includes("online") ||
          section.startsWith("O");
        const mode = isOnline ? "online" : "in-person";

        return {
          college_code: COLLEGE_CODE,
          term: "2026SP",
          course_prefix: prefix,
          course_number: number,
          course_title: title,
          credits,
          crn: `${prefix}-${number}-${section}`,
          days: mode === "online" ? "M T W Th F Sa Su" : daysStr,
          start_time: startTime,
          end_time: endTime,
          start_date: startDate,
          location: mode === "online" ? "Online" : remaining || "Main Campus",
          campus: mode === "online" ? "ONLINE" : "MAIN",
          mode,
          instructor,
          seats_open: 0,
          seats_total: 0,
          prerequisite_text: null,
          prerequisite_courses: [],
        };
      }
    }
    return null;
  }

  // Parse afterDays: "Adams Y 3 1/7/2026 5/6/2026" or "Radford 1 3/9/2026 5/6/2026"
  const afterParts = afterDays.split(/\s+/);
  const instructor = afterParts[0] || "";
  let creditsIdx = 1;
  if (afterParts[1] === "Y") creditsIdx = 2; // Skip prereq marker
  const credits = parseInt(afterParts[creditsIdx]) || 0;

  // Find dates
  const dateMatch2 = afterDays.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  const startDate = dateMatch2 ? formatDate(dateMatch2[1]) : "";

  const isOnline = section.includes("OR") || section.includes("O2") || section.startsWith("O");
  const mode = isOnline ? "online" : "in-person";

  return {
    college_code: COLLEGE_CODE,
    term: "2026SP",
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: `${prefix}-${number}-${section}`,
    days: mode === "online" ? "M T W Th F Sa Su" : daysStr,
    start_time: startTime,
    end_time: endTime,
    start_date: startDate,
    location: mode === "online" ? "Online" : "Main Campus",
    campus: mode === "online" ? "ONLINE" : "MAIN",
    mode,
    instructor,
    seats_open: 0,
    seats_total: 0,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function formatDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

async function main() {
  console.log("Tri-County Community College PDF Schedule Scraper\n");

  const tmpPdf = "/tmp/tricounty-schedule.pdf";
  console.log("Downloading PDF...");
  const res = await fetch(PDF_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPdf, buf);
  console.log(`  Downloaded ${(buf.length / 1024).toFixed(0)} KB`);

  // Extract text with pdfplumber
  const pyScript = `
import pdfplumber, json
lines = []
with pdfplumber.open("${tmpPdf}") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if text:
            lines.extend(text.split("\\n"))
print(json.dumps(lines))
`;
  const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const allLines: string[] = JSON.parse(result);
  console.log(`Extracted ${allLines.length} lines`);

  // Filter to course lines
  const coursePattern = /^[A-Z]{2,4}-\d{3}/;
  const courseLines = allLines.filter(l => coursePattern.test(l.trim()));
  console.log(`Course lines: ${courseLines.length}`);

  const sections: CourseSection[] = [];
  let failed = 0;

  for (const line of courseLines) {
    const section = parseLine(line.trim());
    if (section) {
      sections.push(section);
    } else {
      failed++;
    }
  }

  console.log(`\nParsed ${sections.length} sections (${failed} failed)`);

  const prefixes = new Set(sections.map((s) => s.course_prefix));
  const modes = { "in-person": 0, online: 0, hybrid: 0 };
  sections.forEach((s) => modes[s.mode as keyof typeof modes]++);
  console.log(`  Subject areas: ${prefixes.size}`);
  console.log(`  In-person: ${modes["in-person"]}, Online: ${modes.online}, Hybrid: ${modes.hybrid}`);

  const eng111 = sections.filter((s) => s.course_prefix === "ENG" && s.course_number === "111");
  if (eng111.length) {
    console.log(`\n  Spot check — ENG 111: ${eng111.length} sections`);
    eng111.forEach((s) =>
      console.log(`    ${s.crn}: ${s.days} ${s.start_time}-${s.end_time} (${s.mode}) ${s.instructor}`)
    );
  }

  const outDir = path.join(process.cwd(), "data", "nc", "courses", COLLEGE_CODE);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "2026SP.json");
  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
  console.log(`\nSaved to ${outPath}`);

  fs.unlinkSync(tmpPdf);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
