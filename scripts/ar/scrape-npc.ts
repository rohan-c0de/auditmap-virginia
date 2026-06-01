/**
 * National Park College — PDF schedule scraper.
 *
 * NPC's PeopleSoft instance (oasis.ps.np.edu/psc/npccsprd) is SSO-gated
 * via Microsoft SAML. No public classsearchguest variant exists on the
 * server. However, NPC publishes its full per-term schedule as nightly-
 * refreshed PDFs at:
 *   https://www.np.edu/admissions-aid/documents/{fall,summer,spring}_schedule.pdf
 *
 * The PDFs are generated from a structured nightly export (the title
 * page says "This report is refreshed nightly"). With `pdftotext
 * -layout` the columns come out clean and fixed-width-parseable:
 *
 *   CLASS      TYPE     COURSE ID    COURSE TITLE/TOPIC     CREDITS    DAYS    START    END     START DATE    END DATE   ROOM     INSTRUCTOR  STATUS
 *   1597       ONL      ACT-1003-1   Basic Accounting       3.00       ONL                       09/28/2026   12/09/2026 ONLINE   Lyons       Open
 *   1598       BLEND    ACT-1103-11  Prin/Accounting I      3.00       MW      08:00AM  09:50AM  09/28/2026   12/09/2026 LH-209   Hopper      Open
 *
 * The companion PDFs (fall_online, fall_weekend, fall_accelerated) are
 * filtered subsets of fall_schedule with overlapping CRNs, so we only
 * parse the comprehensive schedule per term and rely on CRN-uniqueness
 * for dedup safety.
 *
 * Requires `pdftotext` (poppler-utils) on PATH.
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-npc.ts             # all current+next terms
 *   npx tsx scripts/ar/scrape-npc.ts --term 2026FA
 */
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

const SLUG = "national-park-college";
const STATE = "ar";
const BASE = "https://www.np.edu/admissions-aid/documents";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

type CourseMode = "in-person" | "online" | "hybrid" | "remote";

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
  mode: CourseMode | null;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: [];
}

interface TermSource {
  pdfName: string; // "fall_schedule" — fetched as {BASE}/{pdfName}.pdf
  termCode: string; // "2026FA"
}

function currentTerms(override?: string): TermSource[] {
  // The site keeps Fall, Summer, and Spring PDFs of the current academic
  // year. As of this writing (2026-05-24) those map to:
  //   spring_schedule → Spring 2026 (past; will be filtered by staleness)
  //   summer_schedule → Summer 2026 (in progress)
  //   fall_schedule    → Fall 2026 (upcoming)
  // When the calendar rolls over to a new academic year, the same PDF
  // URLs serve the new term. The PDF title page is the source of truth
  // for which calendar term/year each represents (parsed in main()).
  const all: TermSource[] = [
    { pdfName: "spring_schedule", termCode: "2026SP" },
    { pdfName: "summer_schedule", termCode: "2026SU" },
    { pdfName: "fall_schedule", termCode: "2026FA" },
  ];
  return override ? all.filter((t) => t.termCode === override) : all;
}

function fetchOnce(url: string): Promise<{ status: number; location?: string; body?: Buffer }> {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/pdf,*/*",
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            resolve({
              status: res.statusCode,
              location: res.headers.location as string | undefined,
            });
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
          );
        },
      )
      .on("error", reject);
  });
}

async function fetchPdf(name: string): Promise<Buffer> {
  let url = `${BASE}/${name}.pdf`;
  for (let i = 0; i < 5; i++) {
    const r = await fetchOnce(url);
    if (r.status >= 200 && r.status < 300 && r.body) return r.body;
    if (r.status >= 300 && r.status < 400 && r.location) {
      url = r.location.startsWith("http") ? r.location : new URL(r.location, url).toString();
      continue;
    }
    throw new Error(`HTTP ${r.status} fetching ${url}`);
  }
  throw new Error(`redirect loop for ${name}.pdf`);
}

function pdfToLayoutText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

// "MTWR" / "MW" / "TR" / "ONL" / "M-F" (expand ranges) / empty
function normalizeDays(s: string): string | null {
  const t = s.trim().toUpperCase();
  if (!t || t === "ONL" || t === "TBA") return null;
  // Expand single ranges like "M-F", "T-R" into MTWRF/TWR
  const rangeOrder = "MTWRFSU";
  const range = t.match(/^([MTWRFSU])-([MTWRFSU])$/);
  if (range) {
    const a = rangeOrder.indexOf(range[1]);
    const b = rangeOrder.indexOf(range[2]);
    if (a >= 0 && b >= a) return rangeOrder.slice(a, b + 1);
  }
  // Otherwise must be a sequence of valid day letters
  if (!/^[MTWRFSU]+$/.test(t)) return null;
  return t;
}

// "08:00AM" → "8:00 AM"
function normalizeTime(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return `${h}:${m[2]} ${m[3].toUpperCase()}`;
}

// "09/28/2026" → "2026-09-28"
function normalizeDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// "ACT-1003-1" → { prefix: "ACT", number: "1003", section: "1" }
// "ENG-1113WL-1" → { prefix: "ENG", number: "1113WL", section: "1" }
function parseCourseId(s: string): { prefix: string; number: string; section: string } | null {
  const m = s.trim().match(/^([A-Z]{2,5})-(\d{2,5}[A-Z]{0,3})-([A-Z0-9]+)$/);
  return m ? { prefix: m[1], number: m[2], section: m[3] } : null;
}

function classifyMode(type: string, days: string | null, room: string): CourseMode | null {
  const t = type.trim().toUpperCase();
  const r = room.trim().toUpperCase();
  if (t === "ONL" || r === "ONLINE") return "online";
  if (t === "BLEND" || t === "HYB" || t === "HYBRID") return "hybrid";
  if (days) return "in-person";
  return null;
}

// Match a course row by anchoring on the CRN at the start, then COURSE ID
// later in the same line. We avoid splitting on whitespace because the
// course title can contain spaces ("Prin/Accounting I"); instead we use a
// permissive regex that captures the high-information fields.
//
// TYPE column can be:
//   - present and dashless: "ONL", "BLEND", "LEC"
//   - present with dash:    "WEB-ENH"
//   - absent entirely (some rows skip it — CRN immediately followed by COURSE ID)
//
// DAYS column can be:
//   - day letters: "MTWR" / "MW" / "TR"
//   - range: "M-F"
//   - "ONL" / "TBA" / empty (online or unscheduled)
// COURSE ID forms observed:
//   "ACT-1003-1"     — plain
//   "ENG-1113WL-1"   — number with letter suffix (writing lab, honors, etc.)
//   "AST-1106-1"     — plain
const ROW_RE =
  /^\s*(\d{4,6})\s+(?:([A-Z][A-Z-]{1,7})\s+)?([A-Z]{2,5}-\d{2,5}[A-Z]{0,3}-[A-Z0-9]+)\s+(.+?)\s+(\d+\.\d{2})\s+([A-Z][A-Z-]{0,6}|\s*)\s{1,}((?:\d{1,2}:\d{2}[AP]M)?)\s+((?:\d{1,2}:\d{2}[AP]M)?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\S+(?:\s+\S+)*?)\s+(\S+(?:\s+\S+)*?)\s+(Open|Closed|Cancelled|Full)\s*$/;

function parseTermPdf(text: string, termCode: string): CourseSection[] {
  const lines = text.split(/\r?\n/);
  const out: CourseSection[] = [];
  const seenCrn = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.includes("As of ")) continue;
    if (line.includes("NATIONAL PARK COLLEGE")) continue;
    if (line.includes("Class Schedule")) continue;
    if (/^\s*CLASS\s+TYPE\s+COURSE ID/.test(line)) continue;
    if (/^\s*MEETING\s+START\s+END/.test(line)) continue;
    if (/^\s*[A-Z]{2,5}:[A-Za-z ]+\s*$/.test(line)) continue;

    const m = line.match(ROW_RE);
    if (!m) continue;

    const [
      ,
      crn,
      typeOpt,
      courseId,
      title,
      creditsStr,
      daysRaw,
      startRaw,
      endRaw,
      startDateRaw,
      _endDateRaw,
      room,
      instructor,
      _status,
    ] = m;
    const type = typeOpt ?? "";

    const cid = parseCourseId(courseId);
    if (!cid) continue;
    if (seenCrn.has(crn)) continue;
    seenCrn.add(crn);

    const days = normalizeDays(daysRaw);
    const startTime = normalizeTime(startRaw);
    const endTime = normalizeTime(endRaw);
    const startDate = normalizeDate(startDateRaw);

    out.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: cid.prefix,
      course_number: cid.number,
      course_title: title.trim(),
      credits: parseFloat(creditsStr),
      crn,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: room.trim() || null,
      campus: "Hot Springs", // NPC has one main campus
      mode: classifyMode(type, days, room),
      instructor: instructor.trim() || null,
      seats_open: null, // PDFs only expose status (Open/Closed), not counts
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return out;
}

// Verify the PDF's title page agrees with our termCode guess. NPC reuses
// the same URL across academic years; the title page is the truth.
const TITLE_RE = /Class Schedule\s*-\s*(Fall|Spring|Summer)\s+Semester\s+(\d{4})/i;

function termCodeFromTitle(text: string): string | null {
  const m = text.match(TITLE_RE);
  if (!m) return null;
  const season = m[1].toUpperCase();
  const year = m[2];
  const code = season === "FALL" ? "FA" : season === "SPRING" ? "SP" : "SU";
  return `${year}${code}`;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termOverride = termIdx >= 0 ? args[termIdx + 1] : undefined;

  const sources = currentTerms(termOverride);
  if (sources.length === 0) {
    console.error(`unknown --term ${termOverride}; valid: 2026SP, 2026SU, 2026FA`);
    process.exit(1);
  }

  fs.mkdirSync(COURSES_DIR, { recursive: true });
  const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let grandTotal = 0;

  for (const src of sources) {
    console.log(`\n--- ${src.pdfName}.pdf ---`);
    let pdfBuf: Buffer;
    try {
      pdfBuf = await fetchPdf(src.pdfName);
    } catch (e) {
      console.error(`  fetch error: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const tmpPath = path.join(tmpdir(), `npc-${src.pdfName}-${process.pid}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuf);
    let text: string;
    try {
      text = pdfToLayoutText(tmpPath);
    } catch (e) {
      console.error(`  pdftotext error: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
    const actualCode = termCodeFromTitle(text);
    if (!actualCode) {
      console.error(`  could not detect term from title page; skipping`);
      continue;
    }
    if (actualCode !== src.termCode) {
      console.log(
        `  NB: PDF title says ${actualCode}, expected ${src.termCode} — using title-derived code`,
      );
    }
    const sections = parseTermPdf(text, actualCode);
    if (sections.length === 0) {
      console.log("  0 sections parsed; skipping write");
      continue;
    }
    const latestStart = Math.max(
      ...sections
        .map((s) => (s.start_date ? Date.parse(s.start_date) : NaN))
        .filter((n) => !Number.isNaN(n)),
    );
    if (Number.isFinite(latestStart) && now - latestStart > STALE_THRESHOLD_MS) {
      console.log(
        `  skip: latest start_date ${new Date(latestStart).toISOString().slice(0, 10)} is >21 days in the past`,
      );
      continue;
    }
    const out = path.join(COURSES_DIR, `${actualCode}.json`);
    fs.writeFileSync(out, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${sections.length} sections → ${out}`);
    grandTotal += sections.length;
  }

  console.log(`\n=== Done: ${grandTotal} sections ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
