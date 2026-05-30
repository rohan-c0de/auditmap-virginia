/**
 * scrape-cygnet.ts
 *
 * Scrapes course section data from Greenville Technical College which uses
 * an Ellucian Cygnet-based course schedule at cygnet.gvltec.edu.
 * Uses direct HTTP POST (no browser needed — the form returns plain HTML).
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-cygnet.ts
 *   npx tsx scripts/sc/scrape-cygnet.ts --term 2026SU
 */

import * as fs from "fs";
import * as path from "path";

const URL = "https://cygnet.gvltec.edu/courselist/courselist.cfm";
const SLUG = "greenville";

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

function detectMode(method: string, location: string, bldg: string): CourseMode {
  const m = (method + " " + location + " " + bldg).toLowerCase();
  if (m.includes("int") || m.includes("online") || m.includes("internet") || m.includes("web") || bldg === "ONL") {
    if (m.includes("hybrid") || m.includes("blended") || m.includes("h-i")) return "hybrid";
    return "online";
  }
  if (m.includes("zoom") || m.includes("virtual")) return "zoom";
  if (m.includes("hybrid") || m.includes("blended") || m.includes("h-i") || m.includes("h-l")) return "hybrid";
  return "in-person";
}

function parseDays(mo: string, tu: string, we: string, th: string, fr: string, sa: string, su: string): string {
  const days: string[] = [];
  if (mo.trim() === "Y") days.push("M");
  if (tu.trim() === "Y") days.push("Tu");
  if (we.trim() === "Y") days.push("W");
  if (th.trim() === "Y") days.push("Th");
  if (fr.trim() === "Y") days.push("F");
  if (sa.trim() === "Y") days.push("Sa");
  if (su.trim() === "Y") days.push("Su");
  return days.join(" ");
}

function normalizeDate(d: string): string {
  // Input: "8-24-2026" → "2026-08-24"
  const match = d.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return d.trim();
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function extractCells(trHtml: string): string[] {
  const cells: string[] = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = tdRegex.exec(trHtml)) !== null) {
    // Strip HTML tags and trim
    cells.push(match[1].replace(/<[^>]*>/g, "").trim());
  }
  return cells;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termCode = termIdx >= 0 ? args[termIdx + 1] : "2026FA";

  console.log(`Scraping Greenville Tech (Cygnet) for ${termCode}...`);

  const resp = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: `termid=${encodeURIComponent(termCode)}&locid=${encodeURIComponent("All Locations")}`,
  });

  if (!resp.ok) {
    console.error(`HTTP ${resp.status}`);
    process.exit(1);
  }

  const html = await resp.text();
  console.log(`  Response: ${(html.length / 1024).toFixed(0)} KB`);

  // Extract data rows (skip header row which has w3-gtcg class)
  const trRegex = /<tr class="w3-gtcg-hover-purple[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: string[][] = [];
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = extractCells(trMatch[1]);
    if (cells.length >= 20) rows.push(cells);
  }

  console.log(`  Found ${rows.length} data rows`);

  // Parse rows into CourseSection objects
  // Columns: Term(0), Section(1), Title(2), Hours(3), Method(4), StartTime(5), EndTime(6),
  //          Mo(7), Tu(8), We(9), Th(10), Fr(11), Sa(12), Su(13),
  //          StartDate(14), EndDate(15), LastDrop(16), LastWithdraw(17),
  //          Bldg(18), Room(19), Location(20), Faculty(21),
  //          EC(22), SM(23), WC(24)
  const sections: CourseSection[] = [];

  for (const cells of rows) {
    const sectionField = cells[1]; // e.g., "ABR-104-M02"
    if (!sectionField) continue;

    // Parse section: "ABR-104-M02" → prefix=ABR, number=104, CRN=M02
    const sectionMatch = sectionField.match(/^([A-Z]{2,4})-(\d{3}[A-Z]?)-(.+)$/);
    if (!sectionMatch) continue;

    const [, prefix, number, crn] = sectionMatch;
    const title = cells[2];
    const creditsRaw = parseFloat(cells[3]);
    const credits = isNaN(creditsRaw) ? 0 : creditsRaw;
    const method = cells[4];
    const startTime = cells[5];
    const endTime = cells[6];
    const bldg = cells[18] || "";
    const room = cells[19] || "";
    const location = cells[20] || "";
    const faculty = cells[21] || "";
    const enrolledRaw = parseInt(cells[22], 10);
    const enrolled = isNaN(enrolledRaw) ? 0 : enrolledRaw;
    const totalRaw = parseInt(cells[23], 10);
    const seatsTotal = isNaN(totalRaw) ? null : totalRaw;

    sections.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn,
      days: parseDays(cells[7], cells[8], cells[9], cells[10], cells[11], cells[12], cells[13]),
      start_time: startTime,
      end_time: endTime,
      start_date: normalizeDate(cells[14]),
      location: [bldg, room].filter(Boolean).join(" "),
      campus: location,
      mode: detectMode(method, location, bldg),
      instructor: faculty && faculty !== "," && faculty !== ", " ? faculty : null,
      seats_open: seatsTotal !== null ? Math.max(0, seatsTotal - enrolled) : null,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  console.log(`  Parsed ${sections.length} course sections`);

  if (sections.length > 0) {
    const outDir = path.join(process.cwd(), "data", "sc", "courses", SLUG);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${termCode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  Written to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
