/**
 * Scrape Cleveland Community College from their "Available Classes" PDF.
 *
 * Source: https://clevelandcc.edu/wp-content/uploads/schedules/curriculum.pdf
 * PDF is auto-generated from WebAdvisor with columns:
 *   Term | Section Name | Title | Meeting Information | Avail/Capacity | Register
 *
 * Since pdfplumber is needed, this script shells out to Python.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-cleveland.ts
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

const COLLEGE_CODE = "cleveland";
const PDF_URL = "https://clevelandcc.edu/wp-content/uploads/schedules/curriculum.pdf";

const DAY_MAP: Record<string, string> = {
  M: "M", MT: "M T", MW: "M W", MWF: "M W F",
  T: "T", TH: "Th", TTH: "T Th", TWTH: "T W Th",
  W: "W", F: "F", S: "Sa",
  MTWTH: "M T W Th", MTWTHF: "M T W Th F",
  MTWTHFSU: "M T W Th F Sa Su",
};

function expandDays(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (DAY_MAP[upper]) return DAY_MAP[upper];

  // Parse character by character
  const days: string[] = [];
  let i = 0;
  while (i < upper.length) {
    if (upper[i] === "T" && upper[i + 1] === "H") {
      days.push("Th"); i += 2;
    } else if (upper[i] === "S" && upper[i + 1] === "U") {
      days.push("Su"); i += 2;
    } else if (upper[i] === "S" && upper[i + 1] === "A") {
      days.push("Sa"); i += 2;
    } else if ("MTWFS".includes(upper[i])) {
      const map: Record<string, string> = { M: "M", T: "T", W: "W", F: "F", S: "Sa" };
      days.push(map[upper[i]]); i++;
    } else {
      i++;
    }
  }
  return days.join(" ");
}

function parseMeeting(meeting: string): {
  days: string; startTime: string; endTime: string;
  startDate: string; location: string; mode: string;
} {
  if (!meeting) return { days: "", startTime: "", endTime: "", startDate: "", location: "", mode: "in-person" };

  // Meeting format: "05/21/26-07/29/26 ONLINE" or
  // "05/21/26-07/29/26 3210 TH 08:00AM-10:00AM" or
  // "07/02/26-08/11/26 3116 MTWTHF 07:00AM-12:00PM"
  const lines = meeting.split("\n").filter(Boolean);
  const firstLine = lines[0] || "";

  // Check if any line is ONLINE
  const hasOnline = lines.some(l => l.includes("ONLINE"));
  const hasInPerson = lines.some(l => !l.includes("ONLINE") && l.match(/\d{2}:\d{2}[AP]M/));

  let mode = "in-person";
  if (hasOnline && hasInPerson) mode = "hybrid";
  else if (hasOnline) mode = "online";

  // Parse start date from first line: "05/21/26-07/29/26 ..."
  let startDate = "";
  const dateMatch = firstLine.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (dateMatch) {
    startDate = `20${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
  }

  // Find the first in-person meeting line for days/times
  const inPersonLine = lines.find(l => !l.includes("ONLINE") && l.match(/\d{2}:\d{2}[AP]M/)) || "";

  let days = "";
  let startTime = "";
  let endTime = "";

  // Pattern: "05/21/26-07/29/26 3210 TH 08:00AM-10:00AM"
  const meetMatch = inPersonLine.match(/\d{2}\/\d{2}\/\d{2}-\d{2}\/\d{2}\/\d{2}\s+\S+\s+([A-Z]+)\s+(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)/);
  if (meetMatch) {
    days = expandDays(meetMatch[1]);
    startTime = meetMatch[2].replace(/([AP]M)/, " $1");
    endTime = meetMatch[3].replace(/([AP]M)/, " $1");
  }

  // Location from room number
  const locMatch = inPersonLine.match(/\d{2}\/\d{2}\/\d{2}-\d{2}\/\d{2}\/\d{2}\s+(\S+)\s+[A-Z]+\s+\d/);
  const location = mode === "online" ? "Online" : (locMatch ? `Room ${locMatch[1]}` : "");

  return { days, startTime, endTime, startDate, location, mode };
}

async function main() {
  console.log("Cleveland Community College PDF Scraper\n");

  // Download PDF
  const tmpPdf = "/tmp/cleveland-schedule.pdf";
  console.log(`Downloading PDF from ${PDF_URL}...`);
  const res = await fetch(PDF_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPdf, buf);
  console.log(`  Downloaded ${(buf.length / 1024).toFixed(0)} KB`);

  // Extract table data using Python/pdfplumber
  console.log("Extracting table data with pdfplumber...");
  const pyScript = `
import pdfplumber, json
with pdfplumber.open("${tmpPdf}") as pdf:
    rows = []
    for page in pdf.pages:
        table = page.extract_table()
        if table:
            for row in table:
                if row[0] and row[0] != 'Term' and row[0] != 'Avail/\\nCapacity':
                    rows.append(row)
    print(json.dumps(rows))
`;
  const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  const rawRows: string[][] = JSON.parse(result);
  console.log(`  Extracted ${rawRows.length} rows`);

  // Group by term
  const byTerm = new Map<string, typeof rawRows>();
  for (const row of rawRows) {
    const term = row[0];
    if (!byTerm.has(term)) byTerm.set(term, []);
    byTerm.get(term)!.push(row);
  }

  console.log("\nSections by term:");
  for (const [term, rows] of byTerm) {
    console.log(`  ${term}: ${rows.length}`);
  }

  // Process each term
  for (const [term, rows] of byTerm) {
    const sections: CourseSection[] = [];

    for (const row of rows) {
      // [Term, Section Name, Title, Meeting Information, Avail/Capacity, Register]
      const secName = (row[1] || "").replace(/\n/g, " ").trim();
      const title = (row[2] || "").replace(/\n/g, " ").trim();
      const meetingInfo = row[3] || "";
      const availCapacity = (row[4] || "").replace(/\n/g, " ").trim();

      // Parse section name: "COM-231-440OL" → prefix=COM, number=231
      const nameMatch = secName.match(/^([A-Z]{2,4})-(\d{3}[A-Z]?)-(.+)$/);
      if (!nameMatch) continue;

      const prefix = nameMatch[1];
      const number = nameMatch[2];

      const { days, startTime, endTime, startDate, location, mode } = parseMeeting(meetingInfo);

      // Parse avail/capacity: "8 / 30"
      const acMatch = availCapacity.match(/(\d+)\s*\/\s*(\d+)/);
      const seatsOpen = acMatch ? parseInt(acMatch[1]) : 0;
      const seatsTotal = acMatch ? parseInt(acMatch[2]) : 0;

      sections.push({
        college_code: COLLEGE_CODE,
        term,
        course_prefix: prefix,
        course_number: number,
        course_title: title,
        credits: 0, // Not in PDF
        crn: secName,
        days,
        start_time: startTime,
        end_time: endTime,
        start_date: startDate,
        location,
        campus: mode === "online" ? "ONLINE" : "MAIN",
        mode,
        instructor: "", // Not in PDF
        seats_open: seatsOpen,
        seats_total: seatsTotal,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    }

    if (sections.length === 0) continue;

    const prefixes = new Set(sections.map((s) => s.course_prefix));
    const modes = { "in-person": 0, online: 0, hybrid: 0 };
    sections.forEach((s) => modes[s.mode as keyof typeof modes]++);

    console.log(`\n${term}: ${sections.length} sections, ${prefixes.size} subjects`);
    console.log(`  In-person: ${modes["in-person"]}, Online: ${modes.online}, Hybrid: ${modes.hybrid}`);

    const outDir = path.join(process.cwd(), "data", "nc", "courses", COLLEGE_CODE);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
    console.log(`  Saved to ${outPath}`);
  }

  // Clean up
  fs.unlinkSync(tmpPdf);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
