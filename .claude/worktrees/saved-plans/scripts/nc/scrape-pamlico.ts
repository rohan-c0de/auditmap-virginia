/**
 * Scrape Pamlico Community College from their PDF class schedule.
 *
 * Source: https://pamlicocc.edu/wp-content/uploads/2025/12/Spring_2026_Class_Schedule_121825.pdf
 * Columns: Prefix, No., Sec, Title, Term, Days, Times, Co, Cr, Bldg/Rm, Instructor
 *
 * Uses Python/pdfplumber for PDF extraction.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-pamlico.ts
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

const COLLEGE_CODE = "pamlico";
const PDF_URL = "https://pamlicocc.edu/wp-content/uploads/2025/12/Spring_2026_Class_Schedule_121825.pdf";

function expandDays(raw: string): string {
  if (!raw || raw === "ONLINE" || raw === "Clinical" || raw === "TBA") return "";
  const days: string[] = [];
  let i = 0;
  const s = raw.toUpperCase().replace(/\s/g, "");
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

function parseTime(raw: string): { start: string; end: string } {
  if (!raw || raw === "ONLINE" || raw === "Clinical" || raw === "TBA") return { start: "", end: "" };
  const m = raw.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-?\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase(), end: m[2].toUpperCase() };
}

async function main() {
  console.log("Pamlico Community College PDF Schedule Scraper\n");

  // Download PDF
  const tmpPdf = "/tmp/pamlico-schedule.pdf";
  console.log(`Downloading PDF...`);
  const res = await fetch(PDF_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPdf, buf);
  console.log(`  Downloaded ${(buf.length / 1024).toFixed(0)} KB`);

  // Extract with pdfplumber
  const pyScript = `
import pdfplumber, json
rows = []
with pdfplumber.open("${tmpPdf}") as pdf:
    for page in pdf.pages:
        table = page.extract_table()
        if table:
            for row in table:
                rows.append(row)
print(json.dumps(rows))
`;
  const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const rawRows: (string | null)[][] = JSON.parse(result);
  console.log(`Extracted ${rawRows.length} rows`);

  const sections: CourseSection[] = [];

  for (const row of rawRows) {
    const prefix = (row[0] || "").trim();
    const num = (row[1] || "").trim();
    const sec = (row[2] || "").trim();
    const title = (row[3] || "").trim();
    // const termInfo = (row[4] || "").trim();
    const daysRaw = (row[5] || "").trim();
    const timesRaw = (row[6] || "").trim();
    // const contactHours = (row[7] || "").trim();
    const creditsRaw = (row[8] || "").trim();
    const bldgRm = (row[9] || "").trim();
    const instructor = (row[10] || "").trim();

    // Skip headers, section dividers, and empty rows
    if (!prefix || !num || prefix === "Prefix") continue;
    if (!num.match(/^\d{3}/)) continue;
    // Skip department header rows like "ACA - STUDENT SUCCESS"
    if (prefix.includes("-")) continue;

    // Handle multi-line cells (some have \n for compound courses)
    const firstDays = daysRaw.split("\n")[0];
    const firstTimes = timesRaw.split("\n")[0];
    const firstBldg = bldgRm.split("\n")[0];

    const days = expandDays(firstDays);
    const { start, end } = parseTime(firstTimes);

    let mode = "in-person";
    if (firstDays === "ONLINE" || firstBldg === "ONLINE") mode = "online";
    else if (bldgRm.includes("ONLINE") && bldgRm !== "ONLINE") mode = "hybrid";

    const credits = parseInt(creditsRaw.split("\n")[0]) || 0;

    sections.push({
      college_code: COLLEGE_CODE,
      term: "2026SP",
      course_prefix: prefix,
      course_number: num,
      course_title: title,
      credits,
      crn: `${prefix}-${num}-${sec}`,
      days: mode === "online" ? "M T W Th F Sa Su" : days,
      start_time: start,
      end_time: end,
      start_date: "",
      location: mode === "online" ? "Online" : firstBldg || "",
      campus: mode === "online" ? "ONLINE" : "MAIN",
      mode,
      instructor,
      seats_open: 0, // Not in PDF
      seats_total: 0,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  console.log(`\nParsed ${sections.length} sections`);

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
