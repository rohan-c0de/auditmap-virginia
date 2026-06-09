/**
 * scrape-frank-phillips.ts — Frank Phillips College (TX) PDF schedule scraper.
 *
 * FPC publishes per-term, per-campus schedules as PDFs from their student
 * resources page (https://fpctx.edu/student-resources/). Each PDF is a
 * fixed-width column report with the schema:
 *
 *   Course Code | Section | Course Name | Credits | Days | Start Time |
 *   End Time | Building/Room | Faculty Last Name | Faculty First Name |
 *   Start Date | End Date
 *
 * Times include AM/PM markers ("11:20AM", "5:30PM") and TBA for online,
 * and dates are M/D/YYYY. PDFs are text-based (no OCR needed); pdftotext
 * -layout from poppler-utils preserves column alignment perfectly.
 *
 * URLs are pinned per term/campus — when FPC publishes a new term, add
 * entries to TERM_PDFS. Discovery: scrape the student-resources page for
 * `Fall|Spring|Summer-YYYY-{Campus}-Schedule.pdf` links.
 *
 * Output: data/tx/courses/frank-phillips-college/{TERM}.json
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-frank-phillips.ts                # all pinned terms
 *   npx tsx scripts/tx/scrape-frank-phillips.ts --term 2026FA  # one term
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inferTccnsCredits } from "../lib/tccns-credits";

const SLUG = "frank-phillips-college";
const COLLEGE_CODE = SLUG;
const OUT_DIR = path.join(process.cwd(), "data", "tx", "courses", SLUG);

interface TermPdf {
  termFile: string;          // file basename like "2026FA"
  termLabel: string;          // human label for logs
  campusName: string;         // value to put in the section's `campus` field
  url: string;
}

// FPC publishes one PDF per (term, campus) combination. Borger is the main
// campus; Dalhart (Rahll), Perryton (Allen), and Online are the satellites.
// Update when new terms appear.
const TERM_PDFS: TermPdf[] = [
  // Fall 2026
  { termFile: "2026FA", termLabel: "Fall 2026", campusName: "Borger",
    url: "https://fpctx.edu/wp-content/uploads/2026/04/Fall-2026-Borger-Campus-Schedule.pdf" },
  { termFile: "2026FA", termLabel: "Fall 2026", campusName: "Dalhart",
    url: "https://fpctx.edu/wp-content/uploads/2026/04/Fall-2026-Rahll-Campus-Schedule.pdf" },
  { termFile: "2026FA", termLabel: "Fall 2026", campusName: "Perryton",
    url: "https://fpctx.edu/wp-content/uploads/2026/04/Fall-2026-Allen-Campus-Schedule.pdf" },
  { termFile: "2026FA", termLabel: "Fall 2026", campusName: "Online",
    url: "https://fpctx.edu/wp-content/uploads/2026/04/Fall-2026-Online-Schedule.pdf" },
  // Summer 2026
  { termFile: "2026SUMINI", termLabel: "Summer Mini 2026", campusName: "All",
    url: "https://fpctx.edu/wp-content/uploads/2026/03/Summer-Mini-2026-Schedule-03.23.2026.pdf" },
  { termFile: "2026SU1", termLabel: "Summer I 2026", campusName: "All",
    url: "https://fpctx.edu/wp-content/uploads/2026/03/Summer-1-Main-2026-Schedule-03.25.2026.pdf" },
  { termFile: "2026SU2", termLabel: "Summer II 2026", campusName: "All",
    url: "https://fpctx.edu/wp-content/uploads/2026/03/Summer-2-Main-2026-Schedule-03.26.2026.pdf" },
  { termFile: "2026SUL", termLabel: "Summer Long 2026", campusName: "All",
    url: "https://fpctx.edu/wp-content/uploads/2026/03/Summer-Long-2026-Schedule-03.26.2026.pdf" },
  // Spring 2026 (already in session; included so cron has continuity until Spring 2027 appears)
  { termFile: "2026SP", termLabel: "Spring 2026", campusName: "Borger",
    url: "https://fpctx.edu/wp-content/uploads/2026/01/Spring-2026-Schedule-01.06.2026_Borger.pdf" },
  { termFile: "2026SP", termLabel: "Spring 2026", campusName: "Dalhart",
    url: "https://fpctx.edu/wp-content/uploads/2026/01/Spring-2026-Schedule-01.06.2026_Rahll.pdf" },
  { termFile: "2026SP", termLabel: "Spring 2026", campusName: "Perryton",
    url: "https://fpctx.edu/wp-content/uploads/2026/01/Spring-2026-Schedule-01.06.2026_Allen.pdf" },
  { termFile: "2026SP", termLabel: "Spring 2026", campusName: "Online",
    url: "https://fpctx.edu/wp-content/uploads/2025/11/Spring-2026-Schedule-11.04.2025_Online.pdf" },
];

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  status: string;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function downloadPdf(url: string, dest: string): boolean {
  try {
    execSync(`curl -sL --max-time 45 -A "Mozilla/5.0" -o "${dest}" "${url}"`,
      { stdio: ["ignore", "ignore", "inherit"] });
    return fs.existsSync(dest) && fs.statSync(dest).size > 1000;
  } catch {
    return false;
  }
}

function pdfToText(pdf: string): string {
  const txt = pdf.replace(/\.pdf$/, ".txt");
  execSync(`pdftotext -layout "${pdf}" "${txt}"`,
    { stdio: ["ignore", "ignore", "inherit"] });
  return fs.readFileSync(txt, "utf8");
}

function normalizeTime(t: string): string {
  // Inputs: "11:20AM", "5:30PM", "TBA", "" — return "HH:MMam"/"HH:MMpm" or "".
  if (!t || /^TBA$/i.test(t)) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return t;
  return `${m[1]}:${m[2]}${m[3].toUpperCase()}`;
}

function normalizeDays(d: string): string {
  // FPC uses M, T, W, R, F, S, Sa (and combos like MW, TR, MWF). Keep as-is
  // except map "TBA" → "" and uppercase Th→R if it ever appears.
  if (!d || /^TBA$/i.test(d)) return "";
  return d.replace(/Th/g, "R");
}

function isoFromMDY(mdy: string): string {
  // "8/17/2026" → "2026-08-17"
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return mdy;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseInstructorName(last: string, first: string): string | null {
  const l = (last || "").trim();
  const f = (first || "").trim();
  if (!l && !f) return null;
  if (!f) return l;
  return `${l}, ${f}`;
}

function inferMode(location: string): string {
  if (/^ONLINE/i.test(location.trim())) return "online";
  return "in-person";
}

// Parse one PDF's text into rows. Strategy: pdftotext -layout separates
// columns with 2+ spaces between cells (and uses single spaces inside
// multi-word cells like "Anatomy & Physiology II" or "Minchew-Johnston").
// Splitting each data line on /\s{2,}/ reliably yields the 12-cell schema:
//   [code, section, title, credits, days, startTime, endTime, room,
//    lastName, firstName, startDate, endDate].
// This is more robust than slicing by header positions because the header is
// left-aligned on each column's header *text*, while data is left-aligned
// inside a wider cell — the two don't line up.
function parseSchedulePdf(
  text: string,
  termFile: string,
  campusOverride: string,
): CourseSection[] {
  const lines = text.split("\n");
  const sections: CourseSection[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // Course codes are PREFIX(2-5)+NUMBER(3-4). Skip anything that doesn't
    // start with one (headers, subheaders, page numbers, footers).
    if (!/^\s*[A-Z]{2,5}\d{3,4}\b/.test(line)) continue;
    const cells = line.trim().split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // Two possible schemas:
    //   12 cells (Fall/Spring): [code, section, title, credits, days, startTime,
    //     endTime, room, lastName, firstName, startDate, endDate]
    //   11 cells (Summer): faculty Last and First are merged into one cell
    //     ("First Last" order, e.g. "Lisa Duncan"), so positions 8-9 collapse.
    let r: RawRow;
    if (cells.length === 12) {
      r = {
        courseCode: cells[0], section: cells[1], title: cells[2], credits: cells[3],
        days: cells[4], startTime: cells[5], endTime: cells[6], room: cells[7],
        lastName: cells[8], firstName: cells[9], startDate: cells[10], endDate: cells[11],
      };
    } else if (cells.length === 11) {
      // Split the merged "First Last" name (best effort: last whitespace token is last name).
      const facultyMerged = cells[8] || "";
      const parts = facultyMerged.split(/\s+/);
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : facultyMerged;
      const firstName = parts.length > 1 ? parts[0] : "";
      r = {
        courseCode: cells[0], section: cells[1], title: cells[2], credits: cells[3],
        days: cells[4], startTime: cells[5], endTime: cells[6], room: cells[7],
        lastName, firstName, startDate: cells[9], endDate: cells[10],
      };
    } else {
      continue; // unknown schema
    }
    const cm = r.courseCode.match(/^([A-Z]{2,5})(\d{3,4})$/);
    if (!cm) continue;

    const credits = parseFloat(r.credits || "");
    // Right-anchor the date columns. In the Summer PDF pdftotext sometimes
    // splits a faculty name into an extra cell, shifting the positional
    // startDate onto a name token (e.g. "Marinda") — which then fails the
    // Supabase `date` column at import. The real start/end dates are always
    // the last two MM/DD/YYYY cells, regardless of how the name split.
    const dateCells = cells.filter((c) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c));
    const startDateRaw =
      dateCells.length >= 2 ? dateCells[dateCells.length - 2] : dateCells[0] || "";
    const endDateRaw = dateCells.length >= 2 ? dateCells[dateCells.length - 1] : "";
    // Many courses have multiple meeting times (lecture + lab, MW + TR) that
    // appear as separate rows in the PDF with the same prefix+section. We keep
    // each as a distinct CourseSection (matching what LSC/Cisco do for the
    // same situation); the CRN encodes day+startTime to disambiguate.
    const meetingKey = `${normalizeDays(r.days || "")}-${normalizeTime(r.startTime || "")}-${r.room || ""}`;
    const sec: CourseSection = {
      college_code: COLLEGE_CODE,
      term: termFile,
      course_prefix: cm[1],
      course_number: cm[2],
      course_title: r.title || "",
      credits:
        Number.isFinite(credits) && credits > 0
          ? credits
          : inferTccnsCredits(cm[2]) || null,
      crn: `${cm[1]}${cm[2]}-${r.section || "00"}-${campusOverride}-${termFile}-${meetingKey}`,
      days: normalizeDays(r.days || ""),
      start_time: normalizeTime(r.startTime || ""),
      end_time: normalizeTime(r.endTime || ""),
      start_date: isoFromMDY(startDateRaw),
      end_date: isoFromMDY(endDateRaw),
      location: r.room || "",
      campus: campusOverride,
      mode: inferMode(r.room || ""),
      instructor: parseInstructorName(r.lastName || "", r.firstName || ""),
      seats_open: null,
      seats_total: null,
      status: "",
      prerequisite_text: null,
      prerequisite_courses: [],
    };
    sections.push(sec);
  }
  return sections;
}

interface RawRow {
  courseCode: string;
  section: string;
  title: string;
  credits: string;
  days: string;
  startTime: string;
  endTime: string;
  room: string;
  lastName: string;
  firstName: string;
  startDate: string;
  endDate: string;
}

function parseArgs(): { onlyTerm: string | null } {
  const a = process.argv.slice(2);
  let onlyTerm: string | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--term" && a[i + 1]) onlyTerm = a[++i];
  }
  return { onlyTerm };
}

function main() {
  const args = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-pdf-"));

  // Group PDFs by termFile — multiple campuses per term → one JSON per term.
  const byTerm = new Map<string, TermPdf[]>();
  for (const p of TERM_PDFS) {
    if (args.onlyTerm && p.termFile !== args.onlyTerm) continue;
    if (!byTerm.has(p.termFile)) byTerm.set(p.termFile, []);
    byTerm.get(p.termFile)!.push(p);
  }
  if (byTerm.size === 0) {
    console.error(`Unknown term '${args.onlyTerm}'. Known: ${[...new Set(TERM_PDFS.map((t) => t.termFile))].join(", ")}`);
    process.exit(1);
  }

  console.log(`Frank Phillips College scraper — ${byTerm.size} term(s)`);
  let grand = 0;
  for (const [term, pdfs] of byTerm) {
    console.log(`\n=== ${term} ===`);
    const allSections: CourseSection[] = [];
    const seen = new Set<string>();
    for (const pdf of pdfs) {
      const dest = path.join(tmp, `${term}-${pdf.campusName}.pdf`);
      console.log(`  ${pdf.campusName}: downloading ${pdf.url.split("/").pop()}`);
      if (!downloadPdf(pdf.url, dest)) {
        console.warn(`    ⚠ download failed — skip`);
        continue;
      }
      const txt = pdfToText(dest);
      const rows = parseSchedulePdf(txt, term, pdf.campusName);
      let added = 0;
      for (const s of rows) {
        if (seen.has(s.crn)) continue;
        seen.add(s.crn);
        allSections.push(s);
        added++;
      }
      console.log(`    parsed ${rows.length} rows (+${added} new)`);
    }
    const out = path.join(OUT_DIR, `${term}.json`);
    fs.writeFileSync(out, JSON.stringify(allSections, null, 2));
    console.log(`  → ${out}  (${allSections.length} sections)`);
    grand += allSections.length;
  }
  console.log(`\n✓ total: ${grand} sections`);
}

main();
