/**
 * scrape-williamsburg-pdf.ts — extract course sections for Williamsburg
 * Technical College (SC) from their public PDF schedules.
 *
 * WTC publishes term schedules at:
 *   https://www.wiltech.edu/current-students/
 * under "Schedules & Book Lists".
 *
 * The PDFs use a visual columnar layout (not a tabular report). When
 * extracted with `pdftotext -layout`, each course row looks like:
 *
 *   Instructor  COURSE-NUM  SECT  Course Title  L-L-C  Day/Time  Delivery  Room  Enrolled
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-williamsburg-pdf.ts
 *   npx tsx scripts/sc/scrape-williamsburg-pdf.ts --term=2026FA
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const COLLEGE_SLUG = "williamsburg";
const STATE = "sc";
const SCHEDULE_PAGE_URL = "https://www.wiltech.edu/current-students/";

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
  seats_open: number;
  seats_total: number;
}

// ---------------------------------------------------------------------------
// Term detection
// ---------------------------------------------------------------------------

function currentTermSlugs(): string[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 1 && m <= 5) return [`${y}SP`, `${y}SU`, `${y}FA`];
  if (m >= 6 && m <= 8) return [`${y}SU`, `${y}FA`];
  return [`${y}FA`, `${y + 1}SP`];
}

function termFromArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--term="));
  return arg ? arg.split("=")[1] : null;
}

// ---------------------------------------------------------------------------
// PDF discovery from the current-students page
// ---------------------------------------------------------------------------

async function discoverSchedulePdfs(): Promise<{ url: string; term: string }[]> {
  const res = await fetch(SCHEDULE_PAGE_URL, { headers: { "User-Agent": UA } });
  const html = await res.text();

  const results: { url: string; term: string }[] = [];
  // Match links like "Spring 2026 Schedule", "Summer 2026 Schedule", "Fall 2026 Schedule"
  const linkRe = /href="([^"]*\.pdf)"[^>]*>\s*((?:Spring|Summer|Fall)\s+\d{4}\s+Schedule)/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const url = match[1];
    const label = match[2];
    const termMatch = label.match(/(Spring|Summer|Fall)\s+(\d{4})/i);
    if (!termMatch) continue;
    const season = termMatch[1].toLowerCase();
    const year = termMatch[2];
    const termCode =
      season === "spring" ? `${year}SP` :
      season === "summer" ? `${year}SU` :
      `${year}FA`;
    results.push({ url, term: termCode });
  }
  return results;
}

// ---------------------------------------------------------------------------
// PDF download + text extraction
// ---------------------------------------------------------------------------

async function downloadPdf(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `wtc-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function pdfToText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// Parser — Williamsburg's visual columnar layout
// ---------------------------------------------------------------------------

// Course rows contain a course code like ABC-123 followed by a 2-digit section
const COURSE_CODE_RE = /([A-Z]{2,4})-(\d{3})/;

function parseWTCLine(line: string): Omit<Section, "term"> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Must contain a course code
  const codeMatch = trimmed.match(COURSE_CODE_RE);
  if (!codeMatch) return null;

  // Use -layout columns: split on 2+ spaces
  const parts = trimmed.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 5) return null;

  // Find which part is the course code
  const codeIdx = parts.findIndex((p) => COURSE_CODE_RE.test(p));
  if (codeIdx < 0) return null;

  const courseCode = parts[codeIdx]; // e.g. "BIO-101"
  const [prefix, number] = courseCode.split("-");

  // Instructor is before the course code
  const instructor = codeIdx > 0 ? parts.slice(0, codeIdx).join(" ") : "";

  // Section number is right after course code
  const sectionNum = parts[codeIdx + 1] || "";
  if (!/^\d{2}$/.test(sectionNum)) return null; // Must be 2-digit section

  // Course title is after section
  const title = parts[codeIdx + 2] || "";
  if (!title || /^\d/.test(title)) return null; // Title shouldn't start with a digit

  // Credits in L-L-C format (e.g. "3-0-3", "3-3-4", "4.5-1-5.5")
  const creditIdx = parts.findIndex((p, i) => i > codeIdx + 2 && /^[\d.]+\s*-\s*[\d.]+\s*-\s*[\d.]+$/.test(p));
  let credits = 0;
  if (creditIdx >= 0) {
    const creditParts = parts[creditIdx].split("-").map((s) => parseFloat(s.trim()));
    credits = Math.round(creditParts[creditParts.length - 1]);
  }

  // Meeting time after credits
  let meetingTime = "";
  let days = "";
  let startTime = "";
  let endTime = "";
  let mode = "online";
  let location = "Online";

  if (creditIdx >= 0) {
    const afterCredits = parts.slice(creditIdx + 1);
    // Find time pattern like "Monday, Wednesday 10:15AM - 12:20PM" or "N/A"
    const timeStr = afterCredits[0] || "";

    if (timeStr === "N/A") {
      mode = "online";
    } else if (timeStr.match(/\d{1,2}:\d{2}[AP]M/)) {
      meetingTime = timeStr;
      // Extract days and times — handles both "Monday 9:00AM - 12:55PM" and "Monday 9:00AM-12:55PM"
      const dayTimeMatch = timeStr.match(/^(.+?)\s+(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)$/);
      if (dayTimeMatch) {
        days = normalizeDays(dayTimeMatch[1]);
        startTime = formatTime12(dayTimeMatch[2]);
        endTime = formatTime12(dayTimeMatch[3]);
        mode = "in-person";
      }
    }

    // Delivery mode
    const deliveryStr = afterCredits[1] || "";
    if (deliveryStr === "Online") mode = "online";
    else if (deliveryStr === "Hybrid") mode = "hybrid";
    else if (deliveryStr === "Face-to-Face") mode = "in-person";

    // Location/room
    const roomStr = afterCredits[2] || "";
    if (roomStr && roomStr !== "D2l Brightspace") {
      location = roomStr;
    }
  }

  // Enrollment is typically the last numeric part
  const lastPart = parts[parts.length - 1];
  const enrolled = /^\d+$/.test(lastPart) ? parseInt(lastPart) : 0;

  return {
    college_code: COLLEGE_SLUG,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: `${prefix}-${number}-${sectionNum}`,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: "",
    location: mode === "online" ? "Online" : location,
    campus: "Main Campus",
    mode,
    instructor: instructor.replace(/^Dr\.\s*/, "Dr. "),
    seats_open: 0,
    seats_total: enrolled > 0 ? Math.max(30, enrolled) : 30,
  };
}

function normalizeDays(raw: string): string {
  return raw
    .replace(/Monday/g, "M")
    .replace(/Tuesday/g, "T")
    .replace(/Wednesday/g, "W")
    .replace(/Thursday/g, "Th")
    .replace(/Friday/g, "F")
    .replace(/Saturday/g, "Sa")
    .replace(/Sunday/g, "Su")
    .replace(/,\s*/g, " ")
    .trim();
}

function formatTime12(raw: string): string {
  // "10:15AM" → "10:15 AM"
  return raw.replace(/([AP]M)$/, " $1");
}

// ---------------------------------------------------------------------------
// Detect term from PDF header
// ---------------------------------------------------------------------------

function detectTermFromText(text: string): string | null {
  const headerMatch = text.match(/Registration Term Code:\s*(\w+)/);
  if (headerMatch) return headerMatch[1];

  const seasonMatch = text.match(/Class Schedule\s*-\s*(Spring|Summer|Fall)\s+(\d{4})/i);
  if (seasonMatch) {
    const s = seasonMatch[1].toLowerCase();
    const y = seasonMatch[2];
    return s === "spring" ? `${y}SP` : s === "summer" ? `${y}SU` : `${y}FA`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const wantedTerms = termFromArg() ? [termFromArg()!] : currentTermSlugs();

  console.log(`[WTC] Discovering schedule PDFs...`);
  const pdfs = await discoverSchedulePdfs();
  console.log(`[WTC] Found ${pdfs.length} schedule PDFs: ${pdfs.map((p) => p.term).join(", ")}`);

  // Filter to wanted terms
  const relevantPdfs = pdfs.filter((p) => wantedTerms.includes(p.term));
  if (relevantPdfs.length === 0) {
    console.log(`[WTC] No PDFs match wanted terms ${wantedTerms.join(", ")}. Trying all found PDFs.`);
    relevantPdfs.push(...pdfs);
  }

  const allSections: Section[] = [];

  for (const { url, term: expectedTerm } of relevantPdfs) {
    const filename = url.split("/").pop()!;
    console.log(`[WTC] Processing ${filename} (expected term: ${expectedTerm})...`);
    try {
      const pdfPath = await downloadPdf(url);
      const text = pdfToText(pdfPath);

      // Detect actual term from PDF content
      const detectedTerm = detectTermFromText(text) || expectedTerm;

      const lines = text.split("\n");
      for (const line of lines) {
        const parsed = parseWTCLine(line);
        if (parsed) {
          allSections.push({ ...parsed, term: detectedTerm });
        }
      }
      fs.unlinkSync(pdfPath);
    } catch (e) {
      console.error(`[WTC] Error processing ${filename}:`, e);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allSections.filter((s) => {
    const key = `${s.term}|${s.crn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[WTC] Parsed ${deduped.length} unique sections`);

  // Group by term and write
  const byTerm = new Map<string, Section[]>();
  for (const s of deduped) {
    const arr = byTerm.get(s.term) || [];
    arr.push(s);
    byTerm.set(s.term, arr);
  }

  const outDir = path.join("data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  for (const [term, sections] of byTerm) {
    const outPath = path.join(outDir, `${term}.json`);
    sections.sort((a, b) =>
      a.course_prefix.localeCompare(b.course_prefix) ||
      a.course_number.localeCompare(b.course_number) ||
      a.crn.localeCompare(b.crn)
    );
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`[WTC] Wrote ${sections.length} sections → ${outPath}`);
  }

  if (deduped.length === 0) {
    console.error("[WTC] WARNING: No sections parsed. Check PDF format.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
