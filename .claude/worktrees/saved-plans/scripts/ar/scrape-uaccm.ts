/**
 * scrape-uaccm.ts — UACCM (Univ of Arkansas Community College Morrilton)
 *
 * UACCM publishes its schedule of classes as a single multi-page PDF at
 * https://www.uaccm.edu/courses/crssch.pdf. There's no Power BI report,
 * no Banner SSB / Colleague / Workday self-service, no JSON API. Same
 * pattern as Diné College (AZ) — `pdftotext -layout` recovers the
 * structure cleanly enough to parse.
 *
 * Layout (per `pdftotext -layout`):
 *
 *   <modifier>      <PREFIX> <NUMBER> <TITLE>
 *   <subterm>       [optional title continuation]
 *   [<fee>]         ACTS Equivalent Course Number is <PREFIX> <NUMBER>
 *
 *                   Line No. Days     Times                  Dates                  Location   Instructor
 *                   <line#>  <days>   <start - end>          <mm/dd/yy - mm/dd/yy>  <loc>      <instructor>
 *                   Lab      <days>   <start - end>          <mm/dd/yy - mm/dd/yy>  <loc>      <instructor>
 *
 *                   <prose description, optional>
 *
 * The "<modifier>" field is one of: "Summer 1", "Summer 2", "Fall",
 * "Spring", "Non-Credit", "New", "Updated", "Cancelled", "Full-Time",
 * "Free". The "<subterm>" line below is "4-Week", "8-Week", "16-Week",
 * "3-Day Camp", or similar. Together they give us the term code; we
 * also derive it from the actual section start_date as a sanity check.
 *
 * Section rows that start with "Lab" are merged with the preceding row
 * (they're the lab component of a science course — same line number,
 * different time block). We keep the lecture row as the primary record.
 *
 * Cancelled courses, courses with subterm "Non-Credit", and rows
 * starting "Lab" are skipped.
 *
 * Requires `pdftotext` (poppler-utils): macOS `brew install poppler`,
 * Linux `apt-get install -y poppler-utils`.
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-uaccm.ts
 *   npx tsx scripts/ar/scrape-uaccm.ts --pdf /tmp/uaccm.pdf
 *   npx tsx scripts/ar/scrape-uaccm.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const STATE = "ar";
const COLLEGE_SLUG = "university-of-arkansas-community-college-morrilton";
const COLLEGE_CODE = COLLEGE_SLUG;
const CAMPUS = "Morrilton";
const PDF_URL = "https://www.uaccm.edu/courses/crssch.pdf";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  location: string | null;
  campus: string | null;
  mode: "in-person" | "online" | "hybrid" | "remote" | null;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function downloadPdf(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`PDF download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function pdftotext(pdfPath: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `pdftotext failed (install poppler-utils): ${(e as Error).message}`,
    );
  }
}

const MONTHS_SUMMER = [5, 6, 7]; // June-Aug start → Summer
const MONTHS_FALL = [7, 8, 9, 10, 11]; // Aug-Dec start → Fall (with overlap, prefer Summer if both)
const MONTHS_SPRING = [0, 1, 2, 3, 4]; // Jan-May start → Spring

/**
 * Derive term code (e.g. "2026SU", "2026FA", "2027SP") from a row's
 * start date "MM/DD/YY".
 */
function termFromDate(mmddyy: string): string | null {
  const m = mmddyy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]) - 1;
  const year = 2000 + Number(m[3]); // PDF always uses 2-digit year
  let season: "SU" | "FA" | "SP";
  if (MONTHS_SPRING.includes(month)) season = "SP";
  else if (MONTHS_SUMMER.includes(month)) season = "SU";
  else if (MONTHS_FALL.includes(month)) season = "FA";
  else return null;
  // Edge case: Spring 2027 starts in Jan 2027 → term "2027SP". Already correct.
  return `${year}${season}`;
}

function parseDate(mmddyy: string): string | null {
  const m = mmddyy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const year = 2000 + Number(m[3]);
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const DAY_MAP: Record<string, string> = {
  M: "M",
  T: "T",
  W: "W",
  R: "R",
  F: "F",
  S: "S",
  U: "U",
};

function normalizeDays(s: string): string | null {
  const t = s.trim().toUpperCase();
  if (!t || /^N\/?A$|^TBA$|^TBD$|^ARRANGED$|^ONLINE$/i.test(t)) return null;
  let out = "";
  for (const c of t) {
    if (DAY_MAP[c]) out += DAY_MAP[c];
  }
  return out || null;
}

function parseTimeRange(s: string): { start: string | null; end: string | null } {
  const m = s.match(
    /(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i,
  );
  if (!m) return { start: null, end: null };
  return {
    start: m[1].toUpperCase().replace(/\s+/g, " "),
    end: m[2].toUpperCase().replace(/\s+/g, " "),
  };
}

function inferMode(days: string | null, location: string | null): CourseSection["mode"] {
  const loc = (location ?? "").toLowerCase();
  if (/online|onln|distance|web/.test(loc)) return "online";
  if (/zoom|remote/.test(loc)) return "remote";
  if (/hybrid|blended/.test(loc)) return "hybrid";
  if (days) return "in-person";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────

/**
 * Line starting a new course block. Examples (after collapsing whitespace):
 *
 *   "Summer 1         ALHE 10204 NURSING ASSISTANT"
 *   "New              ALHE 10204 NURSING ASSISTANT"
 *   "Updated          ENGL 10103 COMPOSITION I"
 *   "Cancelled        ISHP 10003 MEDICAL TERMINOLOGY"
 *   "Non-Credit       WFE 4901 LEVEL 1 - HEAVY EQUIPMENT OPERATOR TRAINING"
 *
 * The left-side modifier label is variable; we always anchor on the
 * <PREFIX> <NUMBER> <TITLE> portion further to the right.
 */
const COURSE_HEADER_RE =
  /^\s*([A-Za-z][A-Za-z0-9 \-/$]*?)?\s*([A-Z]{2,5})\s+(\d{4,5}[A-Z]?)\s+(.+?)\s*$/;

/**
 * Section table row examples (after layout extraction):
 *
 *   "5001     MTWR          7:30 am - 2:30 pm   06/01/26 - 06/25/26   NSC 232   C Replogle"
 *   "Lab      MTWR          10:30 am - 12:20 pm 06/01/26 - 06/25/26   NSC 130   R Medlin"
 *   "0080     MTWR          7:00 am - 5:30 pm   06/01/26 - 06/11/26   WTC       D Williams"
 *
 * Line numbers are 4-5 digit (sometimes leading 0); also "Lab" placeholder.
 */
const SECTION_ROW_RE =
  /^\s*(\d{3,5}|Lab)\s+([A-Za-z/]+|ONL|TBA|TBD|N\/?A)?\s*(\d{1,2}:\d{2}\s*[ap]m\s*-\s*\d{1,2}:\d{2}\s*[ap]m|TBA|Arranged)?\s+(\d{1,2}\/\d{1,2}\/\d{2}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2})\s+(.+?)(?:\s{2,}(.+?))?\s*$/i;

const ACTS_RE = /ACTS\s+Equivalent\s+Course\s+Number\s+is\s+([A-Z]{2,5})\s*(\d{4})/i;

interface CourseHeader {
  modifier: string;
  prefix: string;
  number: string;
  title: string;
  raw: string;
}

function isCourseHeaderLine(line: string): CourseHeader | null {
  // Heuristic: only treat as a course header if line has uppercase prefix
  // adjacent to digit run AND is not a section row. Section rows start with
  // a line-number digit; course-header lines start with a word (modifier).
  if (SECTION_ROW_RE.test(line)) return null;
  const m = line.match(COURSE_HEADER_RE);
  if (!m) return null;
  // Filter: title must be reasonable (mostly alpha, no commas like "Line No.")
  const title = m[4].trim();
  if (!/[A-Za-z]/.test(title)) return null;
  if (/^Line No\b/i.test(title)) return null;
  const modifier = (m[1] ?? "").trim();
  return { modifier, prefix: m[2], number: m[3], title, raw: line };
}

function parseSchedule(text: string): CourseSection[] {
  const lines = text.split(/\r?\n/);
  const sections: CourseSection[] = [];

  let currentCourse: CourseHeader | null = null;
  let cancelled = false;
  let nonCredit = false;
  let titleExtension = ""; // some titles wrap to a second line (e.g. CHEM 12104 "...HEALTH-RELATED" + "PROFESSION")
  let actsHint = ""; // not currently emitted but useful for debug
  let seenLineNoHeader = false; // saw the "Line No. Days Times ..." header

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^\s*Continues On Next Page\.\s*$/i.test(line)) continue;
    if (/^\s*Course Schedule\s*$/i.test(line)) continue;
    if (/^\s*ALL COURSE SCHEDULE\s*$/i.test(line)) continue;

    // ACTS hint
    const actsMatch = line.match(ACTS_RE);
    if (actsMatch) {
      actsHint = `${actsMatch[1]} ${actsMatch[2]}`;
      continue;
    }
    // Section table header → next lines are section rows
    if (/^\s*Line No\.\s+Days\s+Times/i.test(line)) {
      seenLineNoHeader = true;
      continue;
    }

    // Try to parse as section row first (because some headers can be
    // mistaken for rows if course header didn't fire).
    const rowMatch = currentCourse && seenLineNoHeader ? line.match(SECTION_ROW_RE) : null;
    if (rowMatch && currentCourse && !cancelled && !nonCredit) {
      const lineNum = rowMatch[1];
      if (/^Lab$/i.test(lineNum)) {
        // Lab sub-row: skip (the lecture row owns the section).
        continue;
      }
      const daysRaw = rowMatch[2] ?? "";
      const timesRaw = rowMatch[3] ?? "";
      const datesRaw = rowMatch[4];
      const locRaw = (rowMatch[5] ?? "").trim();
      const instRaw = (rowMatch[6] ?? "").trim();

      const startEnd = datesRaw.split(/\s*-\s*/);
      const startDate = parseDate(startEnd[0]);
      const term = termFromDate(startEnd[0]);
      if (!startDate || !term) continue;

      const days = normalizeDays(daysRaw);
      const { start, end } = parseTimeRange(timesRaw);
      const fullTitle = (currentCourse.title + (titleExtension ? " " + titleExtension : "")).trim();
      const crn = `${COLLEGE_CODE}-${currentCourse.prefix}-${currentCourse.number}-${lineNum}-${term}`;

      sections.push({
        college_code: COLLEGE_CODE,
        term,
        course_prefix: currentCourse.prefix,
        course_number: currentCourse.number,
        course_title: fullTitle,
        // UACCM's PDF doesn't surface credits in this layout; leave 0 as
        // a sentinel like other scrapers that can't recover the field.
        credits: 0,
        crn,
        days,
        start_time: start,
        end_time: end,
        start_date: startDate,
        location: locRaw || null,
        campus: CAMPUS,
        mode: inferMode(days, locRaw),
        instructor: instRaw || null,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
      continue;
    }

    // Try course header
    const hdr = isCourseHeaderLine(line);
    if (hdr) {
      // Reset state for the new course.
      currentCourse = hdr;
      titleExtension = "";
      actsHint = "";
      seenLineNoHeader = false;
      const mod = hdr.modifier.toLowerCase();
      cancelled = /cancel/i.test(mod);
      nonCredit = /non[- ]?credit/i.test(mod);
      continue;
    }

    // Title-continuation: a short uppercase phrase right after a course
    // header line, before we see Line No / ACTS / section rows.
    if (currentCourse && !seenLineNoHeader && /^[A-Z][A-Z &/'\-]{1,40}$/.test(line.trim())) {
      titleExtension = (titleExtension + " " + line.trim()).trim();
      continue;
    }
  }
  return sections;
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const pdfIdx = args.indexOf("--pdf");
  const localPdf = pdfIdx >= 0 ? args[pdfIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("UACCM (Morrilton) PDF schedule scraper");

  let pdfPath: string;
  if (localPdf) {
    pdfPath = localPdf;
    console.log(`  using local PDF: ${pdfPath}`);
  } else {
    pdfPath = path.join(os.tmpdir(), `uaccm-crssch-${Date.now()}.pdf`);
    console.log(`  downloading ${PDF_URL}`);
    await downloadPdf(PDF_URL, pdfPath);
    console.log(`  wrote ${pdfPath} (${fs.statSync(pdfPath).size} bytes)`);
  }

  const text = pdftotext(pdfPath);
  const sections = parseSchedule(text);
  console.log(`  parsed ${sections.length} sections`);

  if (sections.length === 0) {
    console.error("  No sections parsed — refusing to overwrite existing data");
    process.exit(1);
  }

  // Group by term, write per-term files.
  const byTerm = new Map<string, CourseSection[]>();
  for (const s of sections) {
    if (!byTerm.has(s.term)) byTerm.set(s.term, []);
    byTerm.get(s.term)!.push(s);
  }

  // 21-day-past staleness cutoff (same as other AR scrapers).
  const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const outDir = path.join(process.cwd(), "data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });
  let grandTotal = 0;
  for (const [term, group] of [...byTerm.entries()].sort()) {
    const latestStart = Math.max(
      ...group
        .map((s) => (s.start_date ? Date.parse(s.start_date) : NaN))
        .filter((n) => !Number.isNaN(n)),
    );
    if (Number.isFinite(latestStart) && now - latestStart > STALE_THRESHOLD_MS) {
      console.log(
        `  skip ${term}: latest start_date ${new Date(latestStart).toISOString().slice(0, 10)} is >21 days in the past`,
      );
      continue;
    }
    const out = path.join(outDir, `${term}.json`);
    fs.writeFileSync(out, JSON.stringify(group, null, 2) + "\n");
    console.log(`  ${term}: ${group.length} sections → ${out}`);
    grandTotal += group.length;
  }
  console.log(`\nDone: ${grandTotal} sections shipped`);

  if (!noImport && grandTotal > 0) {
    try {
      const { importCoursesToSupabase } = await import("../lib/supabase-import");
      await importCoursesToSupabase(STATE);
    } catch (e) {
      console.log(`Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
