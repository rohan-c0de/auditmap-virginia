/**
 * scrape-northeastern-pdf.ts — extract course sections for Northeastern
 * Technical College (SC) from their public PDF schedules.
 *
 * NETC publishes per-department PDF schedules at:
 *   http://netc.edu/academic_pathways.php?Academic-Programming-Course-Schedules-39
 *
 * Each PDF is a Colleague-generated fixed-width report with columns:
 *   TERM | COURSE | SECT | MOI | TITLE | MAX | TKN | OPEN | CREDS | INSTRUCTOR | WKS | FROM | TO | BGN | END | DAYS | ROOM
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-northeastern-pdf.ts
 *   npx tsx scripts/sc/scrape-northeastern-pdf.ts --term=2026FA
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const COLLEGE_SLUG = "northeastern";
const STATE = "sc";
const SCHEDULE_INDEX_URL =
  "http://netc.edu/academic_pathways.php?Academic-Programming-Course-Schedules-39";

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
  end_date: string;
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
  const terms: string[] = [];
  if (m >= 1 && m <= 5) {
    terms.push(`${y}SP`, `${y}SU`, `${y}FA`);
  } else if (m >= 6 && m <= 8) {
    terms.push(`${y}SU`, `${y}FA`);
  } else {
    terms.push(`${y}FA`, `${y + 1}SP`);
  }
  return terms;
}

function termFromArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--term="));
  return arg ? arg.split("=")[1] : null;
}

// ---------------------------------------------------------------------------
// PDF discovery
// ---------------------------------------------------------------------------

async function discoverPdfUrls(): Promise<string[]> {
  const res = await fetch(SCHEDULE_INDEX_URL, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const pdfPattern = /href="(\/uploads\/[^"]*\.pdf)"/gi;
  const urls = new Set<string>();
  let match;
  while ((match = pdfPattern.exec(html)) !== null) {
    const pdfPath = match[1];
    // Skip non-schedule PDFs (start dates, CE, high school, pageland duplicates)
    if (
      pdfPath.includes("-start-date") ||
      pdfPath.includes("-ce.pdf") ||
      pdfPath.includes("-high-school") ||
      pdfPath.includes("sect-sched-current") ||
      pdfPath.includes("-pageland") ||
      pdfPath.includes("-departments")
    ) continue;
    urls.add(`http://netc.edu${pdfPath}`);
  }
  return [...urls];
}

// ---------------------------------------------------------------------------
// PDF download + text extraction
// ---------------------------------------------------------------------------

async function downloadPdf(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `netc-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
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
// Parser — fixed-width columns from Colleague report
// ---------------------------------------------------------------------------

const COURSE_RE = /^[\s]*(\S+)\s+([A-Z]{2,4}-\d{3}[A-Z]?)\s+(\S+)\s+(\S+)\s+(.{30,40}?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.{20,25}?)\s+(\d+)\s+(\d\d\/\d\d)\s+(\d\d\/\d\d)\s+(.+)$/;

function parseNETCLine(line: string, currentYear: number): Section | null {
  // Try to match a course row. The format is fixed-width but varies slightly.
  // Use a more robust approach: split on 2+ spaces.
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("TERM") || trimmed.startsWith("Title:") || trimmed.startsWith("Number of")) return null;

  // Check if line has a course code pattern (ABC-123)
  const courseMatch = trimmed.match(/([A-Z]{2,4})-(\d{3}[A-Z]?)/);
  if (!courseMatch) return null;

  // Split on 2+ spaces to get fields
  const parts = trimmed.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 10) return null;

  // Find which part contains the course code
  const courseIdx = parts.findIndex((p) => /^[A-Z]{2,4}-\d{3}[A-Z]?$/.test(p));
  if (courseIdx < 0) return null;

  // Expected order relative to course: term is before, rest after
  const termRaw = parts[courseIdx - 1] || "";
  const sect = parts[courseIdx + 1] || "";
  const moi = parts[courseIdx + 2] || "";
  const title = parts[courseIdx + 3] || "";

  // Find numeric fields after title
  const afterTitle = parts.slice(courseIdx + 4);
  const maxSeats = parseInt(afterTitle[0]) || 0;
  const taken = parseInt(afterTitle[1]) || 0;
  const open = parseInt(afterTitle[2]) || 0;
  const credits = parseFloat(afterTitle[3]) || 0;
  const instructor = afterTitle[4] || "";
  const weeks = afterTitle[5] || "";
  const fromDate = afterTitle[6] || "";
  const toDate = afterTitle[7] || "";

  // Remaining fields are time/days/room
  const rest = afterTitle.slice(8);
  let startTime = "";
  let endTime = "";
  let days = "";
  let room = "";

  if (moi === "OL") {
    days = "Online";
    room = "Online";
  } else {
    startTime = rest[0] || "";
    endTime = rest[1] || "";
    days = rest[2] || "";
    room = rest[3] || "";
  }

  // Normalize term code
  const term = normalizeTermCode(termRaw, currentYear);
  if (!term) return null;

  const [prefix, number] = courseMatch[0].split("-");

  // Determine delivery mode
  let mode: string;
  if (moi === "OL") mode = "online";
  else if (moi === "DL") mode = "online";
  else if (moi === "HY" || moi === "HYB") mode = "hybrid";
  else mode = "in-person";

  // Convert dates (MM/DD format) to full dates
  const startDate = fromDate ? `${currentYear}-${fromDate.replace("/", "-")}` : "";
  const endDate = toDate ? `${currentYear}-${toDate.replace("/", "-")}` : "";

  return {
    college_code: COLLEGE_SLUG,
    term,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: `${prefix}-${number}-${sect}`,
    days: days === "Online" ? "" : expandDays(days),
    start_time: formatTime(startTime),
    end_time: formatTime(endTime),
    start_date: startDate,
    end_date: endDate,
    location: room === "OL" || room === "Online" ? "Online" : room,
    campus: room.startsWith("D") ? "Dillon" : room.startsWith("P") ? "Pageland" : room.startsWith("M") ? "Marlboro" : "Cheraw",
    mode,
    instructor: instructor.replace(/,\s*$/, ""),
    seats_open: open,
    seats_total: maxSeats,
  };
}

function normalizeTermCode(raw: string, year: number): string | null {
  // Full format: 2026SU, 2026FA, 2026SP
  if (/^\d{4}(SU|FA|SP)$/.test(raw)) return raw;
  // Short summer sub-terms: 26U5A → 2026SU, 26U5B → 2026SU, 26U75 → 2026SU
  if (/^\d{2}U/.test(raw)) return `20${raw.slice(0, 2)}SU`;
  // Short format: 26FA → 2026FA
  if (/^\d{2}(SU|FA|SP)$/.test(raw)) return `20${raw}`;
  return null;
}

function expandDays(raw: string): string {
  if (!raw || raw === "OL") return "";
  return raw
    .replace(/M(?!o)/g, "M ")
    .replace(/T(?!h|u)/g, "T ")
    .replace(/W(?!e)/g, "W ")
    .replace(/R/g, "Th ")
    .replace(/F/g, "F ")
    .replace(/Sa/g, "Sa ")
    .replace(/Su/g, "Su ")
    .trim();
}

function formatTime(raw: string): string {
  if (!raw || raw === "On" || raw === "Line" || raw === "N/A") return "";
  // Already has am/pm: 8:00a → 8:00 AM, 12:30p → 12:30 PM
  const m = raw.match(/^(\d{1,2}:\d{2})([ap])$/);
  if (m) return `${m[1]} ${m[2] === "a" ? "AM" : "PM"}`;
  return raw;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const year = new Date().getFullYear();
  const wantedTerms = termFromArg() ? [termFromArg()!] : currentTermSlugs();

  console.log(`[NETC] Discovering PDF schedule URLs...`);
  const pdfUrls = await discoverPdfUrls();
  console.log(`[NETC] Found ${pdfUrls.length} schedule PDFs`);

  const allSections: Section[] = [];

  for (const url of pdfUrls) {
    const filename = url.split("/").pop()!;
    console.log(`[NETC] Processing ${filename}...`);
    try {
      const pdfPath = await downloadPdf(url);
      const text = pdfToText(pdfPath);
      const lines = text.split("\n");

      for (const line of lines) {
        const section = parseNETCLine(line, year);
        if (section && wantedTerms.includes(section.term)) {
          allSections.push(section);
        }
      }
      fs.unlinkSync(pdfPath);
    } catch (e) {
      console.error(`[NETC] Error processing ${filename}:`, e);
    }
  }

  // Deduplicate by CRN+term (same section may appear in dept + campus PDFs)
  const seen = new Set<string>();
  const deduped = allSections.filter((s) => {
    const key = `${s.term}|${s.crn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[NETC] Parsed ${deduped.length} unique sections across ${wantedTerms.join(", ")}`);

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
    console.log(`[NETC] Wrote ${sections.length} sections → ${outPath}`);
  }

  if (deduped.length === 0) {
    console.error("[NETC] WARNING: No sections parsed. Check PDF format.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
