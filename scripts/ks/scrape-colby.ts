/**
 * Colby Community College — PDF schedule extractor
 *
 * Colby publishes only PDF schedules at:
 *   https://colbycc.edu/academics/schedules/fall-schedule.pdf
 *   https://colbycc.edu/academics/schedules/summer-schedule.pdf
 *
 * They run TrojanWeb (a Jenzabar product) internally but the public-facing
 * schedule is PDF-only. The PDFs are well-formatted `pdftotext -layout`
 * targets — fixed-width columns with subject headings as section dividers.
 *
 * Column layout (each row):
 *   CRS    SEC SESSION COURSE NAME      TYPE CR INSTRUCTOR LOCATION DAYS TIME       S/DATE     E/DATE      FEES
 *
 * Section types: LECT, HYBR, ONL, LAB. We use these as landmark anchors
 * since their column position varies depending on course-name length, but
 * they always appear before CR (numeric credits).
 *
 * Dependencies: `pdftotext` (from poppler-utils). Install: `brew install poppler`.
 *
 * Tracks GitHub issue #958.
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-colby.ts
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SLUG = "colby-community-college";
const STATE = "ks";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const PDF_URLS: Record<string, string> = {
  fall: "https://colbycc.edu/academics/schedules/fall-schedule.pdf",
  summer: "https://colbycc.edu/academics/schedules/summer-schedule.pdf",
};

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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: null;
  seats_total: null;
  prerequisite_text: null;
  prerequisite_courses: string[];
}

function downloadPdf(url: string, dest: string): void {
  execSync(`curl -sL --max-time 60 -o "${dest}" "${url}"`, { stdio: "ignore" });
  const size = fs.statSync(dest).size;
  if (size < 10_000) throw new Error(`PDF download too small: ${url} → ${size} bytes`);
}

function pdfToText(pdfPath: string): string {
  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`);
  return fs.readFileSync(txtPath, "utf-8");
}

function parseDate(raw: string): string {
  // e.g. "8/17/2026"
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseTime(raw: string): { start: string; end: string } {
  // e.g. "8:00 AM-9:15 AM" or "10:50 AM-12:05 P" (truncated by pdftotext)
  const m = raw.match(/(\d{1,2}:\d{2}\s?[AP]M?)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M?)/);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase().trim(), end: m[2].toUpperCase().trim() };
}

function inferMode(type: string, days: string, location: string): "in-person" | "online" | "hybrid" {
  if (type === "HYBR") return "hybrid";
  if (type === "ONL" || location === "ONL") return "online";
  if (days === "ARR" || days === "" || days === "-") return "in-person"; // arranged but still in-person
  return "in-person";
}

function parseRow(line: string): Omit<CourseSection, "college_code" | "term"> | null {
  // Find the section type landmark: LECT, HYBR, ONL, LAB
  const typeMatch = line.match(/\b(LECT|HYBR|ONL|LAB)\b/);
  if (!typeMatch) return null;
  const type = typeMatch[1];
  const typeIdx = typeMatch.index!;

  // Before TYPE: course code + section + session + title
  const before = line.slice(0, typeIdx).trim();
  // Pattern: PREFIX###[L] SEC SESSION TITLE
  // Session is one of: Main, 8 Week 1, 8 Week 2, Online, etc. — single word or "8 Week N"
  const beforeMatch = before.match(/^([A-Z]{2,4})(\d{3}[A-Z]?)\s+(\S+)\s+(.+)$/);
  if (!beforeMatch) return null;
  const [, prefix, number, section, rest] = beforeMatch;

  // rest = "Main     Title" or "8 Week 2 Title"
  let session = "";
  let title = "";
  const m8w = rest.match(/^(8\s+Week\s+\d)\s+(.+)$/);
  const mOnline = rest.match(/^(Online|Main)\s+(.+)$/);
  if (m8w) {
    session = m8w[1];
    title = m8w[2].trim();
  } else if (mOnline) {
    session = mOnline[1];
    title = mOnline[2].trim();
  } else {
    // Single-word session then title
    const m = rest.match(/^(\S+)\s+(.+)$/);
    if (!m) return null;
    session = m[1];
    title = m[2].trim();
  }

  // After TYPE: CR INSTRUCTOR LOCATION DAYS TIME S/DATE E/DATE [FEES]
  const after = line.slice(typeIdx + type.length).trim();
  // Split by 2+ spaces to preserve "LECT" / "ONL" cell separation
  const parts = after.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 4) return null;

  // First field is credits (digits)
  const credits = parseFloat(parts[0]) || 0;

  // Last field often contains both dates 1-space-separated (pdftotext quirk),
  // or dates + FEES. Pull the first MM/DD/YYYY date we find from the right
  // side of the row.
  const dateMatches = after.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? [];
  const start_date = dateMatches.length > 0 ? parseDate(dateMatches[0]) : "";

  // Time is typically the field with "-" between two times
  const timeIdx = parts.findIndex((p) => /\d{1,2}:\d{2}\s?[AP]M?-\d{1,2}:\d{2}\s?[AP]M?/.test(p) || p === "-");
  const timeRaw = timeIdx >= 0 ? parts[timeIdx] : "";
  const { start: start_time, end: end_time } = timeRaw === "-" ? { start: "", end: "" } : parseTime(timeRaw);

  // Days is typically the field before TIME — short string like ARR / TR / MW / ONL / R
  const daysIdx = timeIdx > 0 ? timeIdx - 1 : -1;
  let days = daysIdx >= 0 ? parts[daysIdx] : "";
  // ONL in days column means online section — clear days
  if (days === "ONL" || days === "ARR") days = "";

  // Instructor is parts[1] (right after credits)
  const instructor = parts[1] || null;

  // Location is between INSTRUCTOR and DAYS — for online classes location may be empty
  let location = "";
  if (daysIdx > 2) location = parts.slice(2, daysIdx).join(" ");

  return {
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: `${prefix}-${number}-${section}`,
    days,
    start_time,
    end_time,
    start_date,
    location,
    campus: session === "Online" || daysIdx >= 0 && parts[daysIdx] === "ONL" ? "Online" : "Main",
    mode: inferMode(type, days, parts[daysIdx] ?? ""),
    instructor: instructor === "" ? null : instructor,
    seats_open: null,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function inferTermFromDates(sections: Array<{ start_date: string }>): string {
  const dateCounts: Record<string, number> = {};
  for (const s of sections) {
    const m = s.start_date.match(/^(\d{4})-(\d{2})/);
    if (!m) continue;
    const ym = `${m[1]}-${m[2]}`;
    dateCounts[ym] = (dateCounts[ym] || 0) + 1;
  }
  const dominant = Object.entries(dateCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominant) return "";
  const [year, month] = dominant.split("-");
  const m = parseInt(month, 10);
  if (m >= 1 && m <= 5) return `${year}SP`;
  if (m >= 6 && m <= 7) return `${year}SU`;
  if (m >= 8 && m <= 12) return `${year}FA`;
  return "";
}

async function scrapeOne(label: string, url: string): Promise<{ term: string; sections: CourseSection[] }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `colby-${label}-`));
  const pdfPath = path.join(tmpDir, "schedule.pdf");
  downloadPdf(url, pdfPath);
  const text = pdfToText(pdfPath);
  const lines = text.split(/\r?\n/);

  const partialSections: Array<Omit<CourseSection, "college_code" | "term">> = [];
  for (const line of lines) {
    // Skip subject headings, headers, page footers
    if (!/^[A-Z]{2,4}\d{3}/.test(line.trim())) continue;
    const parsed = parseRow(line);
    if (parsed) partialSections.push(parsed);
  }

  const term = inferTermFromDates(partialSections);
  if (!term) {
    console.log(`    ! ${label}: could not infer term`);
    return { term: "", sections: [] };
  }

  const sections = partialSections.map((s) => ({
    college_code: SLUG,
    term,
    ...s,
  }));
  return { term, sections };
}

async function main() {
  console.log("🦌 Colby Community College PDF scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const byTerm = new Map<string, CourseSection[]>();
  for (const [label, url] of Object.entries(PDF_URLS)) {
    console.log(`   Fetching ${label}: ${url}`);
    const { term, sections } = await scrapeOne(label, url);
    if (sections.length === 0) {
      console.log(`    → 0 sections (${label})`);
      continue;
    }
    const existing = byTerm.get(term) ?? [];
    byTerm.set(term, [...existing, ...sections]);
    console.log(`    ✓ ${label} → ${term}: ${sections.length} sections`);
  }

  // Drop past terms
  const today = new Date().toISOString().slice(0, 10);
  let grandTotal = 0;
  for (const [term, sections] of byTerm) {
    const latestDate = sections.map((s) => s.start_date).filter(Boolean).sort().reverse()[0] ?? "";
    if (latestDate && latestDate < today) {
      console.log(`    ⊘ ${term}: latest date ${latestDate} < today, skipping`);
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    → wrote ${term} (${sections.length} sections) → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ Colby scraper failed:", err);
  process.exit(1);
});
