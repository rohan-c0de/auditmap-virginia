/**
 * Chief Dull Knife College — PDF schedule scraper
 *
 * CDKC publishes per-term class schedules as single-page PDFs at:
 *   http://www.cdkc.edu/{Season}{Year}.pdf
 *   e.g. http://www.cdkc.edu/Summer2026.pdf
 *
 * The PDF text extracts as tab-delimited lines with columns:
 *   Course # | Course Title | Credits | Days | Times | Instructor | Room
 * Department headers appear as standalone lines (no tabs).
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-cdkc.ts                     # all active terms
 *   npx tsx scripts/mt/scrape-cdkc.ts --term Summer2026   # single term
 *   npx tsx scripts/mt/scrape-cdkc.ts --no-import
 */
import { PDFParse } from "pdf-parse";
import * as fs from "fs";
import * as path from "path";

const SLUG = "chief-dull-knife-college";
const STATE = "mt";
const BASE_URL = "http://www.cdkc.edu";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

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

function getTermCandidates(): { pdfName: string; termCode: string }[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const candidates: { pdfName: string; termCode: string }[] = [];

  // Try current and upcoming terms
  const seasons = [
    { name: "Spring", code: "SP", months: [1, 2, 3, 4, 5] },
    { name: "Summer", code: "SU", months: [5, 6, 7, 8] },
    { name: "Fall", code: "FA", months: [7, 8, 9, 10, 11, 12] },
  ];

  for (const season of seasons) {
    if (season.months.includes(month)) {
      candidates.push({ pdfName: `${season.name}${year}`, termCode: `${year}${season.code}` });
    }
    // Also try next occurrence
    if (month > Math.max(...season.months)) {
      candidates.push({ pdfName: `${season.name}${year + 1}`, termCode: `${year + 1}${season.code}` });
    }
  }

  return candidates;
}

function parseTimeRange(times: string): { start: string; end: string; mode: CourseMode } {
  const t = times.trim();
  if (t.toUpperCase() === "HYBRID" || t.toLowerCase().includes("hybrid")) {
    return { start: "", end: "", mode: "hybrid" };
  }
  if (t === "TBD" || t === "") {
    return { start: "", end: "", mode: "in-person" };
  }
  if (t.toUpperCase() === "ONLINE") {
    return { start: "", end: "", mode: "online" };
  }

  const match = t.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) return { start: "", end: "", mode: "in-person" };
  return { start: match[1], end: match[2], mode: "in-person" };
}

function parseCourseCode(code: string): { prefix: string; number: string } | null {
  // "AD 251", "MA 071-079-01", "SC 154"
  const match = code.match(/^([A-Z]{2})\s+(\S+)/);
  if (!match) return null;
  return { prefix: match[1], number: match[2] };
}

async function fetchPdf(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function scrapeTerm(pdfName: string, termCode: string): Promise<CourseSection[]> {
  const url = `${BASE_URL}/${pdfName}.pdf`;
  console.log(`  Fetching ${url}...`);

  const data = await fetchPdf(url);
  if (!data) {
    console.log(`  → not found (HTTP 404 or fetch error)`);
    return [];
  }

  const parser = new PDFParse({ data });
  const result = await parser.getText();

  const sections: CourseSection[] = [];

  for (const page of result.pages) {
    const lines = page.text.split("\n");

    for (const line of lines) {
      const parts = line.split("\t");
      // Course lines have 7 tab-separated fields
      if (parts.length < 6) continue;

      const codeRaw = parts[0].trim();
      const parsed = parseCourseCode(codeRaw);
      if (!parsed) continue;

      const title = parts[1]?.trim() || "";
      const credits = parseInt(parts[2]?.trim() || "0", 10) || 0;
      const days = parts[3]?.trim() || "";
      const timesRaw = parts[4]?.trim() || "";
      const instructor = parts[5]?.trim() || null;
      const room = parts[6]?.trim() || "";

      const { start, end, mode } = parseTimeRange(timesRaw);

      // Check title for hybrid indicator too
      const effectiveMode = title.toLowerCase().includes("(hybrid)") ? "hybrid" : mode;

      sections.push({
        college_code: SLUG,
        term: termCode,
        course_prefix: parsed.prefix,
        course_number: parsed.number,
        course_title: title.replace(/\s*\(Hybrid\)\s*/i, "").trim(),
        credits,
        crn: `${parsed.prefix}-${parsed.number}`,
        days: days === "TBD" ? "" : days,
        start_time: start,
        end_time: end,
        start_date: "",
        location: room,
        campus: "Main",
        mode: effectiveMode,
        instructor,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    }
  }

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🏔️  Chief Dull Knife College PDF scraper");
  console.log(`   Source: ${BASE_URL}/{Season}{Year}.pdf`);

  const candidates = termFilter
    ? [{ pdfName: termFilter, termCode: termFilter.replace(/^(Spring|Summer|Fall)(\d{4})$/, (_, s: string, y: string) => {
        const code = s === "Spring" ? "SP" : s === "Summer" ? "SU" : "FA";
        return `${y}${code}`;
      })}]
    : getTermCandidates();

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  let grandTotal = 0;

  for (const { pdfName, termCode } of candidates) {
    const sections = await scrapeTerm(pdfName, termCode);

    if (sections.length === 0) continue;

    const outPath = path.join(COURSES_DIR, `${termCode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  → ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ chief-dull-knife-college: ${grandTotal} total sections`);

  if (noImport) {
    console.log("   (--no-import: skipping Supabase import)");
  }
}

main().catch((err) => {
  console.error("❌ CDKC scraper failed:", err);
  process.exit(1);
});
