/**
 * Scrape Martin Community College from their PDF class schedule.
 *
 * Source: https://www.martincc.edu/curriculumclassschedule
 * Columns: Section Name, Title, Start, End, Bldg, Rm, Cr., Start Time, End Time,
 *          M, T, W, Th, F, Instructor First, Instructor Last, Census Dates, Location
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-martin.ts
 *   npx tsx scripts/nc/scrape-martin.ts --term 2026SU
 *   npx tsx scripts/nc/scrape-martin.ts --term 2026FA
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

const COLLEGE_CODE = "martin";

const PDF_URLS: Record<string, string> = {
  "2026SP": "https://www.martincc.edu/sites/default/files/SpringSchedule2026%28NEW%29.pdf",
  "2026SU": "https://www.martincc.edu/sites/default/files/2026SummerSchedule.pdf",
  "2026FA": "https://www.martincc.edu/sites/default/files/Fall2026Schedule%28Final%29.pdf",
};

async function main() {
  const termIdx = process.argv.indexOf("--term");
  const term = termIdx >= 0 ? process.argv[termIdx + 1] : "2026SP";
  const pdfUrl = PDF_URLS[term];
  if (!pdfUrl) {
    console.error(`No PDF URL configured for term ${term}. Available: ${Object.keys(PDF_URLS).join(", ")}`);
    process.exit(1);
  }

  console.log(`Martin Community College PDF Schedule Scraper`);
  console.log(`Term: ${term}\n`);

  const tmpPdf = "/tmp/martin-schedule.pdf";
  console.log(`Downloading PDF from ${pdfUrl}...`);
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPdf, buf);
  console.log(`  Downloaded ${(buf.length / 1024).toFixed(0)} KB`);

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
    const secName = (row[0] || "").trim();
    const title = (row[1] || "").trim();
    const startDateRaw = (row[2] || "").trim();
    // const endDate = (row[3] || "").trim();
    const bldg = (row[4] || "").trim();
    // const rm = (row[5] || "").trim();
    const creditsRaw = (row[6] || "").trim();
    const startTimeRaw = (row[7] || "").trim();
    const endTimeRaw = (row[8] || "").trim();
    const dayM = (row[9] || "").trim();
    const dayT = (row[10] || "").trim();
    const dayW = (row[11] || "").trim();
    const dayTh = (row[12] || "").trim();
    const dayF = (row[13] || "").trim();
    const instrFirst = (row[14] || "").trim();
    const instrLast = (row[15] || "").trim();
    // const censusDate = (row[16] || "").trim();
    const location = (row[17] || "").trim();

    // Skip headers and continuation/empty rows
    if (!secName || secName === "Section Name") continue;

    // Parse section name: "ACA-115-50" → prefix=ACA, number=115
    const nameMatch = secName.match(/^([A-Z]{2,4})-(\d{3}[A-Z]?)-(.+)$/);
    if (!nameMatch) continue;

    const prefix = nameMatch[1];
    const number = nameMatch[2];

    // Build days string
    const days: string[] = [];
    if (dayM === "Y") days.push("M");
    if (dayT === "Y") days.push("T");
    if (dayW === "Y") days.push("W");
    if (dayTh === "Y") days.push("Th");
    if (dayF === "Y") days.push("F");
    const daysStr = days.join(" ");

    // Determine mode
    const isOnline = bldg === "WEB" || location === "WEB";
    const mode = isOnline ? "online" : "in-person";

    // Parse start date: "1/9/2026" → "2026-01-09"
    let startDate = "";
    const dateMatch = startDateRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      startDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;
    }

    // Format times
    const startTime = startTimeRaw || "";
    const endTime = endTimeRaw || "";

    const instructor = instrFirst && instrLast ? `${instrLast}, ${instrFirst}` : instrLast || instrFirst || "";

    sections.push({
      college_code: COLLEGE_CODE,
      term,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: isNaN(parseInt(creditsRaw, 10)) ? 0 : parseInt(creditsRaw, 10),
      crn: secName,
      days: mode === "online" ? "M T W Th F" : daysStr,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: mode === "online" ? "Online" : location || bldg,
      campus: mode === "online" ? "ONLINE" : "MAIN",
      mode,
      instructor,
      seats_open: 0,
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
  const outPath = path.join(outDir, `${term}.json`);
  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
  console.log(`\nSaved to ${outPath}`);

  fs.unlinkSync(tmpPdf);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
