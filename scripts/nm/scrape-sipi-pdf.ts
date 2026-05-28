/**
 * scrape-sipi-pdf.ts — extract course sections for Southwestern Indian
 * Polytechnic Institute (SIPI) from its public PDF class schedule.
 *
 * SIPI publishes its term schedule on the homepage (https://www.sipi.edu)
 * under "Class Schedule — Summer 2026" (or similar). The PDF is hosted on
 * edl.io and the file path rotates each term, so this scraper discovers the
 * current URL from the homepage rather than hardcoding it.
 *
 * The PDF uses a visual columnar layout. With `pdftotext -layout`, each
 * course row looks like:
 *
 *   ACCT 2110x (80) Principles of Accounting IA   TBA   TBA          3   Feng    ARNGED
 *   ACCT 2115 (70)   Survey of Accounting          TTh   01:00-03:30  3   Ekofo   BE113
 *
 * Columns: PREFIX NUMBER(SECTION)  Title  Days  Times  Cr  Instructor  Room  Mode  Comments
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/nm/scrape-sipi-pdf.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const COLLEGE_SLUG = "southwestern-indian-polytechnic-institute";
const STATE = "nm";
const HOMEPAGE_URL = "https://www.sipi.edu";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface Section {
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

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoverSchedulePdf(): Promise<
  { url: string; term: string; label: string } | null
> {
  const res = await fetch(HOMEPAGE_URL, { headers: { "User-Agent": UA } });
  const html = await res.text();
  // Match: <a href="...pdf">Summer 2026 Class Schedule</a>
  const re =
    /href="([^"]*\.pdf)"[^>]*>\s*((?:Spring|Summer|Fall|Winter)\s+\d{4})\s+Class\s+Schedule/gi;
  const m = re.exec(html);
  if (!m) return null;
  const url = m[1];
  const label = m[2];
  const [season, year] = label.split(/\s+/);
  const code =
    season.toLowerCase() === "spring"
      ? `${year}SP`
      : season.toLowerCase() === "summer"
        ? `${year}SU`
        : season.toLowerCase() === "fall"
          ? `${year}FA`
          : `${year}WI`;
  return { url, term: code, label };
}

async function downloadPdf(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(
    os.tmpdir(),
    `sipi-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function pdfToText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// Term → start_date
// SIPI doesn't print the term's first-day-of-class on the schedule itself.
// Use the published NM community college term starts as a sane default.
// ---------------------------------------------------------------------------

function termStartDate(term: string): string {
  const year = term.slice(0, 4);
  const season = term.slice(4);
  if (season === "SP") return `${year}-01-12`;
  if (season === "SU") return `${year}-06-01`;
  if (season === "FA") return `${year}-08-17`;
  return `${year}-01-12`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// Section header above each row group, e.g. "Accounting". We track the most
// recent header so we can attach it to rows if useful for debugging.
const SUBJECT_HEADER_RE = /^[A-Z][a-zA-Z ]+$/;

// Course row: PREFIX NUMBER(optional letter suffix) (SECTION) ...
//   "ACCT 2110x (80) Principles of Accounting IA  TBA  TBA  3  Feng  ARNGED"
//   "ARTH 251 (1)    Art Traditions of the American Southwest MW 05:00-07:50p 3 Vasher GS113"
const COURSE_RE =
  /^([A-Z]{2,5})\s+(\d{2,4}[A-Za-z]?)\s+\(([^)]+)\)\s+(.+)$/;

const TIME_RE =
  /^(\d{1,2}:\d{2}[ap]?)\s*[-–]\s*(\d{1,2}:\d{2}[ap]?)$/i;

function parseLine(
  line: string,
): Omit<Section, "term" | "start_date"> | null {
  const trimmed = line.replace(/\s+$/, "");
  if (!trimmed) return null;
  const m = trimmed.match(COURSE_RE);
  if (!m) return null;
  const [, prefix, number, section, rest] = m;

  // Tail of the row contains:  Title  Days  Times  Cr  Instructor  Room  [Mode]
  // We exploit the column structure: split on 2+ spaces.
  const cols = rest.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (cols.length < 4) return null;

  const title = cols[0];
  // Days/times may appear as two separate cols ("TBA", "TBA") or merged into
  // one ("M-Th 01:00-01:50") depending on column widths in the PDF.
  // Credits is the first standalone 1-2 digit numeric col after title.
  // Then: instructor, room, optional mode.
  let days = "";
  let times = "";
  let creditsIdx = -1;
  for (let i = 1; i < cols.length; i++) {
    if (/^\d{1,2}$/.test(cols[i])) {
      creditsIdx = i;
      break;
    }
  }
  if (creditsIdx < 0) return null;
  // Everything between title and credits is days+times
  const between = cols.slice(1, creditsIdx).join(" ");
  // Try to extract a time range from `between`
  const tMatch = between.match(/(\d{1,2}:\d{2}[ap]?\s*[-–]\s*\d{1,2}:\d{2}[ap]?)/i);
  if (tMatch) {
    times = tMatch[1].replace(/\s*[-–]\s*/, "-");
    days = between.replace(tMatch[1], "").trim();
  } else {
    // No time pattern — treat as days only (e.g. "TBA TBA")
    const parts = between.split(/\s+/);
    days = parts[0] || "";
    times = parts[1] || "";
  }
  const creditsRaw = cols[creditsIdx] || "";
  const instructor = (cols[creditsIdx + 1] || "").trim();
  const room = (cols[creditsIdx + 2] || "").trim();
  const mode = (cols[creditsIdx + 3] || "").trim();

  // Credits should be a small integer
  const credits = parseInt(creditsRaw, 10);
  if (!Number.isFinite(credits) || credits < 0 || credits > 12) return null;

  // Parse times
  let startTime = "";
  let endTime = "";
  const inferredMode = "";
  if (times && times !== "TBA") {
    const tm = times.match(TIME_RE);
    if (tm) {
      startTime = normalizeTime(tm[1], tm[2]).start;
      endTime = normalizeTime(tm[1], tm[2]).end;
    }
  }

  // Location & mode
  let location = room || "TBA";
  let modeOut = "in-person";
  if (/online/i.test(room) || /online/i.test(mode)) {
    modeOut = "online";
    location = "Online";
  } else if (/arnged|tba/i.test(room) && (!times || times === "TBA")) {
    modeOut = "arranged";
  }
  if (inferredMode) modeOut = inferredMode;

  // Section is the parenthesized value, e.g. "80", "1", "70"
  const sectionClean = section.trim();
  const crn = `${prefix}-${number}-${sectionClean}`;

  return {
    college_code: COLLEGE_SLUG,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn,
    days: days === "TBA" ? "" : normalizeDays(days),
    start_time: startTime,
    end_time: endTime,
    location,
    campus: "Main Campus",
    mode: modeOut,
    instructor,
    seats_open: null,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function normalizeDays(raw: string): string {
  // SIPI uses: M, T, W, Th, F, MW, TTh, M-Th, MTWThF, etc. Already terse.
  return raw.trim();
}

function normalizeTime(
  start: string,
  end: string,
): { start: string; end: string } {
  // SIPI uses 24h-ish notation with a trailing "p" sometimes on the END only
  // to indicate PM range. e.g. "01:00-03:30" (assume AM/PM by context),
  // "05:10-06:35p" (PM), "03:40-06:10p" (PM).
  // Heuristic: if either end ends with 'p', treat both as PM; if start hour
  // < end hour and no marker, leave as-is (assume morning).
  const isPm = /p$/i.test(end) || /p$/i.test(start);
  const cleanStart = start.replace(/[ap]$/i, "");
  const cleanEnd = end.replace(/[ap]$/i, "");
  const fmt = (hhmm: string, pm: boolean) => {
    const [h, m] = hhmm.split(":");
    let hour = parseInt(h, 10);
    if (pm && hour < 12) hour += 12;
    return `${String(hour).padStart(2, "0")}:${m}`;
  };
  if (isPm) {
    // Both times are PM
    return { start: fmt(cleanStart, true), end: fmt(cleanEnd, true) };
  }
  // Try to detect crossing noon: e.g. 11:00-01:30 (likely 11a-1:30p).
  const sh = parseInt(cleanStart.split(":")[0], 10);
  const eh = parseInt(cleanEnd.split(":")[0], 10);
  if (sh > eh) {
    return { start: fmt(cleanStart, false), end: fmt(cleanEnd, true) };
  }
  return { start: cleanStart, end: cleanEnd };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[SIPI] Discovering current schedule PDF...");
  const disc = await discoverSchedulePdf();
  if (!disc) {
    console.error(
      "[SIPI] No '<season> <year> Class Schedule' PDF link found on homepage.",
    );
    process.exit(1);
  }
  console.log(`[SIPI] Found: ${disc.label} -> ${disc.url}`);

  const pdfPath = await downloadPdf(disc.url);
  const text = pdfToText(pdfPath);
  fs.unlinkSync(pdfPath);

  const startDate = termStartDate(disc.term);
  const lines = text.split("\n");
  const sections: Section[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const key = `${parsed.course_prefix}-${parsed.course_number}-${parsed.crn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({ ...parsed, term: disc.term, start_date: startDate });
  }

  if (sections.length === 0) {
    console.error("[SIPI] No sections parsed — bailing without writing data.");
    process.exit(1);
  }

  sections.sort(
    (a, b) =>
      a.course_prefix.localeCompare(b.course_prefix) ||
      a.course_number.localeCompare(b.course_number) ||
      a.crn.localeCompare(b.crn),
  );

  const outDir = path.join("data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${disc.term}.json`);
  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");

  console.log(`[SIPI] Wrote ${sections.length} sections → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
