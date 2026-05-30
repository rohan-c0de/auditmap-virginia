/**
 * Eastern West Virginia Community & Technical College — PDF schedule scraper
 *
 * Cluster #3 from issue #456 (WordPress + PDF): Eastern WV publishes its
 * full course schedule as a single PDF per term on a WordPress page at
 *   https://easternwv.edu/academics/class-schedules/
 *
 * URLs follow the pattern `/wp-content/uploads/<Term>-<Year>-<Code>-Schedule.pdf`
 * where <Code> is a 6-digit Eastern internal term code (academic year + 01/02/03
 * for Fall/Spring/Summer). We scrape the listing page to find all available
 * term PDFs, filter to current+future, and parse each with `pdftotext -layout`.
 *
 * Requires: pdftotext (poppler) on PATH. `brew install poppler` on macOS;
 * the GitHub Actions Ubuntu runners ship it pre-installed.
 *
 * Output schema matches the canonical CourseSection shape used elsewhere
 * (see scripts/il/scrape-iecc.ts or scripts/lib/scrape-banner-ssb.ts).
 * Fields the PDF doesn't carry — seats_open, seats_total, prerequisite_text,
 * prerequisite_courses — are emitted as null/[].
 *
 * Usage:
 *   npx tsx scripts/wv/scrape-eastern-wv.ts            # write JSON
 *   npx tsx scripts/wv/scrape-eastern-wv.ts --dry-run  # parse + log, no write
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

// Canonical slug from data/wv/institutions.json. WV's institutions index uses
// short slugs (e.g. "eastern", "blue-ridge") rather than full names.
const SLUG = "eastern";
const STATE = "wv";
const SCHEDULE_URL = "https://easternwv.edu/academics/class-schedules/";

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
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// Term resolution
// ---------------------------------------------------------------------------

/** Eastern WV term code → our canonical term string. Code shape: YYYYNN where
 *  YYYY is the academic-year-end and NN is 01=Fall, 02=Spring, 03=Summer. So
 *  202701 = Fall 2026, 202602 = Spring 2026, 202603 = Summer 2026. */
function termCodeToStandard(code: string): string | null {
  const m = code.match(/^(\d{4})(0[123])$/);
  if (!m) return null;
  const ayEnd = parseInt(m[1], 10);
  const suffix = m[2];
  if (suffix === "01") return `${ayEnd - 1}FA`;
  if (suffix === "02") return `${ayEnd}SP`;
  if (suffix === "03") return `${ayEnd}SU`;
  return null;
}

/** Today's "active" terms — same logic as pickRecentSsbTerms uses elsewhere:
 *  keep anything whose rank ≥ current calendar term. */
function isFutureOrCurrent(termStd: string): boolean {
  const m = termStd.match(/^(\d{4})(SP|SU|FA)$/);
  if (!m) return false;
  const rank = parseInt(m[1], 10) * 10 + { SP: 1, SU: 2, FA: 3 }[m[2] as "SP" | "SU" | "FA"];
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const curSeason = mo <= 5 ? "SP" : mo <= 7 ? "SU" : "FA";
  const curRank = y * 10 + { SP: 1, SU: 2, FA: 3 }[curSeason];
  return rank >= curRank;
}

async function discoverTermPdfs(): Promise<{ termCode: string; termStd: string; url: string }[]> {
  const res = await fetch(SCHEDULE_URL);
  if (!res.ok) throw new Error(`Schedules page returned ${res.status}`);
  const html = await res.text();

  // Match every PDF link containing a 6-digit term code: e.g.
  //   /wp-content/uploads/Fall-2026-202701-Schedule.pdf
  //   /wp-content/uploads/Spring-2026-Schedule-202602.pdf
  //   /wp-content/uploads/Summer-Schedule-202603.pdf
  const out: { termCode: string; termStd: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]*\/wp-content\/uploads\/[^"]*?(\d{6})[^"]*?\.pdf)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[2];
    if (seen.has(code)) continue;
    seen.add(code);
    const std = termCodeToStandard(code);
    if (!std) continue;
    const rel = m[1];
    const url = rel.startsWith("http") ? rel : `https://easternwv.edu${rel}`;
    out.push({ termCode: code, termStd: std, url });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDF parsing
// ---------------------------------------------------------------------------

async function downloadPdf(url: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `ewv-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF download ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function pdfToText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

/**
 * Parse rows out of pdftotext -layout output. With -layout, each section is a
 * SINGLE physical line — the CRN, dept, course-section, title, credits, time,
 * days, room, and instructor all live on the same row. Lines below that are
 * just visual title wrapping (e.g. "learning resource", "(Eastern Web)") which
 * we drop. This keeps parsing trivially row-local and avoids the trap of
 * gluing instructor names to wrapped note text from the row below.
 */
function parseScheduleText(text: string, termStd: string, campusHint: string): CourseSection[] {
  const lines = text.split("\n");
  const sections: CourseSection[] = [];
  let currentCampus = campusHint;

  const isCrnLine = (l: string) => /^\s*\d{3}\s+[A-Z]{2,4}\s+\d/.test(l);

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (!line.trim()) continue;

    // Campus header lines: "Main Campus", "Petersburg Center", "Moorefield Center"
    if (/^\s*[A-Z][A-Za-z ]{3,40}(Campus|Center)\s*$/.test(line)) {
      currentCampus = line.trim();
      continue;
    }

    if (!isCrnLine(line)) continue;
    const collapsed = line.replace(/\s+/g, " ").trim();
    const sec = parseRow(collapsed, termStd, currentCampus);
    if (sec) sections.push(sec);
  }

  return sections;
}

/** Parse one logical (post-line-join) section row. */
function parseRow(s: string, termStd: string, campus: string): CourseSection | null {
  // CRN + dept + courseNumber-section + ... + credits + (time|WEB|ARR) + days + room + instructor
  // We anchor on:
  //   - leading 3-digit CRN
  //   - dept (2-4 uppercase letters)
  //   - course-number-section "(\d{3}[A-Z]?)-([A-Z0-9]+)"
  //   - trailing instructor "Last, F." or "F. Last" or "Staff"
  // and slot middle text into title + credits + meeting fields.
  const head = s.match(
    /^(\d{3})\s+([A-Z]{2,4})\s+(\d{2,3}[A-Z]?)-([A-Z0-9]+)\s+(.+)$/
  );
  if (!head) return null;
  const [, crn, prefix, number, sectionCode, rest] = head;

  // Credits: a standalone integer 1-9 between title and time. We find the
  // LAST single-digit credits token before a time/WEB/ARR marker.
  const meetMarker = rest.match(/\b(WEB|ARR|\d{1,2}:\d{2}\s*[AP]M)\b/);
  if (!meetMarker) return null;
  const titlePlusCredits = rest.slice(0, meetMarker.index).trim();
  const tail = rest.slice(meetMarker.index!).trim();

  // Pull off the credits — last whitespace-delimited single-digit number
  // (sometimes preceded by ";" from a title-ending semicolon-note).
  const credMatch = titlePlusCredits.match(/^(.*?)\s+(\d)\s*$/);
  if (!credMatch) return null;
  const titleRaw = credMatch[1].trim();
  const credits = parseInt(credMatch[2], 10);

  // Clean title:
  //   - drop trailing semicolon-delimited junk ("; E-learning resource")
  //   - drop trailing unclosed parenthetical fragment ("Drug Dosage Calculation (Eastern"
  //     happens when pdftotext wraps "(Eastern Web)" across the column boundary)
  const title = titleRaw
    .replace(/;.*$/, "")
    .replace(/\s*\([A-Z][A-Za-z]*\s*$/, "")
    .trim();

  // Meeting fields: "WEB * * Instr" OR "9:30 AM – 10:45 AM TR 204 S. Murphy"
  let days = "";
  let startTime = "";
  let endTime = "";
  let room = "";
  let instructor: string | null = null;
  let mode: CourseSection["mode"] = "in-person";

  // WEB form
  const webM = tail.match(/^WEB\s+\S+\s+\S+\s+(.+)$/);
  // ARR form
  const arrM = tail.match(/^ARR\s+ARR\s+ARR\s+(.+)$/);
  // Time form: "9:30 AM – 10:45 AM TR 204 S. Murphy"
  // Uses an en-dash "–" or hyphen "-".
  const timeM = tail.match(
    /^(\d{1,2}:\d{2}\s*[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)\s+([A-Z*]+)\s+(\S+)\s+(.+)$/
  );

  if (webM) {
    mode = "online";
    instructor = webM[1].trim() || null;
  } else if (arrM) {
    mode = "in-person";
    days = "ARR";
    room = "ARR";
    instructor = arrM[1].trim() || null;
  } else if (timeM) {
    startTime = timeM[1].trim();
    endTime = timeM[2].trim();
    days = timeM[3].trim();
    room = timeM[4].trim();
    instructor = timeM[5].trim() || null;
    mode = "in-person";
  } else {
    return null;
  }

  return {
    college_code: SLUG,
    term: termStd,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: `${crn}-${sectionCode}`,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: "",
    location: room,
    campus,
    mode,
    instructor: instructor && instructor !== "Staff" ? instructor : instructor,
    seats_open: null,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("📄 Eastern WV PDF scraper");
  console.log(`   Listing: ${SCHEDULE_URL}`);

  const allPdfs = await discoverTermPdfs();
  const active = allPdfs.filter((p) => isFutureOrCurrent(p.termStd));
  console.log(
    `   Found ${allPdfs.length} term PDFs total; ${active.length} active:\n` +
      active.map((p) => `     ${p.termStd} (${p.termCode}) → ${p.url}`).join("\n")
  );
  if (active.length === 0) return;

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  // Eastern WV's primary teaching site is its Moorefield main campus; we keep
  // that as the campus default and let the parser override per-section if it
  // sees a "<X> Campus/Center" header inside the PDF.
  const DEFAULT_CAMPUS = "Main Campus";

  for (const p of active) {
    console.log(`\n   === ${p.termStd} ===`);
    const pdfPath = await downloadPdf(p.url);
    const text = pdfToText(pdfPath);
    fs.unlinkSync(pdfPath);
    const sections = parseScheduleText(text, p.termStd, DEFAULT_CAMPUS);
    console.log(`     Parsed ${sections.length} sections`);
    if (sections.length > 0) {
      const sample = sections[0];
      console.log(
        `     sample: ${sample.course_prefix} ${sample.course_number} "${sample.course_title}" — ${sample.crn}, ${sample.credits}cr, ${sample.mode}`
      );
    }
    if (dryRun) continue;
    const outFile = path.join(outDir, `${p.termStd}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
    console.log(`     ✓ ${outFile}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ Done — ${grandTotal} sections across ${active.length} term(s).`);
}

main().catch((err) => {
  console.error("❌ Eastern WV scraper failed:", err);
  process.exit(1);
});
