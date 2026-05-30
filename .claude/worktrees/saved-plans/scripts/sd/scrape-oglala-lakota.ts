/**
 * Oglala Lakota College (SD) — PDF schedule scraper.
 *
 * OLC publishes per-term semester schedules as PDFs at
 *   https://www.olc.edu/assets/docs/uploads/{file}.pdf
 * Each PDF is a fixed-width column report grouped by college center
 * (Pass Creek, East Wakpamni, Pejuta Haka, Oglala, He Sapa, etc.).
 *
 * Layout per row:
 *   PC | Dept | No | Title | Cr | Day | Time | Fee | 1st | Instructor | Loc | Mtype
 * where PC is the per-center section code (O1, O2, ...) and Dept+No is
 * the course identifier (e.g. "Engl 103" or "Math 134*").
 *
 * Uses pdftotext -layout (poppler-utils) to preserve column alignment,
 * then a tolerant regex extracts each row. Some columns drift in width
 * between centers, so we anchor on the Dept/No pattern.
 *
 * URLs are pinned to specific files we manually verified — when OLC
 * publishes a new term, add an entry to TERM_PDFS.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SLUG = "oglala-lakota-college";
const STATE = "sd";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

interface TermPdf {
  termCode: string;
  termLabel: string;
  url: string;
}

const TERM_PDFS: TermPdf[] = [
  {
    termCode: "fall-2026",
    termLabel: "Fall 2026",
    url: "https://www.olc.edu/assets/docs/uploads/fall-2026-050726.pdf",
  },
  {
    termCode: "summer-2026",
    termLabel: "Summer 2026",
    url: "https://www.olc.edu/assets/docs/uploads/summer-schedule-2026-by-cbavc-052126.pdf",
  },
];

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

// Maps the center-header text (uppercased, no extra whitespace) to a
// short campus slug used in the output `campus` field.
const CENTER_BY_HEADER: Record<string, string> = {
  "PASS CREEK COLLEGE CENTER": "pass-creek",
  "EAST WAKPAMNI COLLEGE CENTER": "east-wakpamni",
  "PEJUTA HAKA COLLEGE CENTER": "pejuta-haka",
  "OGLALA COLLEGE CENTER": "oglala",
  "HE SAPA COLLEGE CENTER": "he-sapa",
  "EAGLE NEST COLLEGE CENTER": "eagle-nest",
  "PINE RIDGE COLLEGE CENTER": "pine-ridge",
  "LACREEK COLLEGE CENTER": "lacreek",
  "PAHIN SINTE COLLEGE CENTER": "pahin-sinte",
  "WOUNDED KNEE COLLEGE CENTER": "wounded-knee",
  "CHEYENNE RIVER COLLEGE CENTER": "cheyenne-river",
};

function downloadPdf(url: string, dest: string) {
  execSync(
    `curl -sL --max-time 45 -A "Mozilla/5.0" -o "${dest}" "${url}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

function pdfToText(pdf: string): string {
  const txt = pdf.replace(/\.pdf$/, ".txt");
  execSync(`pdftotext -layout "${pdf}" "${txt}"`, {
    stdio: ["ignore", "ignore", "inherit"],
  });
  return fs.readFileSync(txt, "utf8");
}

function parseTime(t: string): { start: string; end: string } {
  // "5:00-8:00" — usually evening (PM) for OLC, occasionally morning.
  // OLC convention from PDFs: numbers without AM/PM. Times <8 are PM,
  // times >=8 are AM. End time always >= start time on same period.
  const m = t.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return { start: "", end: "" };
  let sh = parseInt(m[1], 10);
  let eh = parseInt(m[3], 10);
  // Apply PM offset to times that look like afternoon/evening (1-7).
  // OLC's day classes are 8-12 (AM), evening 1-9 (PM).
  if (sh >= 1 && sh <= 7) sh += 12;
  if (eh >= 1 && eh <= 9) eh += 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${pad(sh)}:${m[2]}`,
    end: `${pad(eh)}:${m[4]}`,
  };
}

function normalizeDay(d: string): string {
  // OLC uses M, T, W, Th, F. CC convention is M T W R F.
  const lc = d.toLowerCase();
  if (lc === "th") return "R";
  if (lc === "tu") return "T";
  if (lc === "m-f") return "MTWRF";
  if (lc === "m-th") return "MTWR";
  if (lc === "tu-f") return "TWRF";
  return d.toUpperCase();
}

function inferMode(mtype: string, loc: string): CourseSection["mode"] {
  const m = mtype.toUpperCase();
  if (m === "F2F") return "in-person";
  if (m.includes("BAVC") || m.includes("AVC") || m === "CASD") return "hybrid"; // broadcast across centers
  if (m === "ONLINE" || m === "WEB") return "online";
  if (loc.includes("/")) return "hybrid";
  return "in-person";
}

function parseRows(
  text: string,
  termCode: string,
  termLabel: string,
): CourseSection[] {
  const lines = text.split("\n");
  const rows: CourseSection[] = [];
  let currentCenter = "unknown";
  let currentPrefix2 = ""; // PC two-letter prefix from header row

  // Regex anchored on Dept + No (3 digits with optional *), tolerant of
  // surrounding columns. Captures:
  //   section, dept, num, title-junk-incl-credits, day, time, rest
  const rowRe = new RegExp(
    // section code (1-3 chars, often O1/O2.../10)
    "^\\s*([0-9A-Z]{1,3})\\s+" +
      // dept (1-5 letters, possibly mixed case like LdCm)
      "([A-Za-z]{1,5})\\s+" +
      // course number with optional *
      "(\\d{2,4})(\\*?)\\s+" +
      // title (greedy, but bounded by credits which is a 1-2 digit number)
      "(.+?)\\s+" +
      // credits (1-2 digits)
      "(\\d{1,2})\\s+" +
      // day code: M/T/W/Th/F or combinations / ranges like M-F
      "(M-F|M-Th|Tu-F|M|T|W|Th|F|Tu|MW|TR|MWF|Sa|Su)\\s+" +
      // time
      "(\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2})" +
      // rest of line
      "(.*)$",
  );

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    // Detect center header (with or without trailing ":")
    const upper = line.trim().toUpperCase().replace(/:$/, "");
    if (CENTER_BY_HEADER[upper]) {
      currentCenter = CENTER_BY_HEADER[upper];
      currentPrefix2 = "";
      continue;
    }
    // Summer PDF uses "HESAPA COLLEGE CENTER" without space.
    if (upper === "HESAPA COLLEGE CENTER") {
      currentCenter = CENTER_BY_HEADER["HE SAPA COLLEGE CENTER"];
      continue;
    }

    // Detect column header rows (start with 2-char center code + "Dept")
    const hdrMatch = line.match(/^([A-Z]{2})\s+Dept/);
    if (hdrMatch) {
      currentPrefix2 = hdrMatch[1];
      continue;
    }

    // Try to parse a course row
    const m = line.match(rowRe);
    if (!m) continue;

    const [, sectionCode, dept, num, _star, title, creditsRaw, dayRaw, time, rest] =
      m;

    const days = normalizeDay(dayRaw);
    const { start, end } = parseTime(time);

    // Rest of line: " Fee ... 1st INSTRUCTOR  Loc Mtype"
    // We need INSTRUCTOR, Loc, Mtype. Skip Fee ($...) and 1st flag.
    let restClean = rest.trim();
    // Drop "$ 95" / "$95" fee fragments
    restClean = restClean.replace(/\$\s*\d+/g, "").trim();
    const restTokens = restClean.split(/\s{2,}/).filter(Boolean);
    // Common shape: ["1st? instructor", "loc", "mtype"] or
    //               ["instructor", "loc", "mtype"]
    let instructor = "";
    let loc = "";
    let mtype = "";
    if (restTokens.length >= 3) {
      instructor = restTokens[restTokens.length - 3].replace(/^1st\s+/i, "");
      loc = restTokens[restTokens.length - 2];
      mtype = restTokens[restTokens.length - 1];
    } else if (restTokens.length === 2) {
      instructor = restTokens[0].replace(/^1st\s+/i, "");
      loc = "";
      mtype = restTokens[1];
    } else if (restTokens.length === 1) {
      instructor = restTokens[0].replace(/^1st\s+/i, "");
    }

    const credits = parseInt(creditsRaw, 10);
    // Heuristic: ignore rows with absurd credits or empty dept.
    if (credits < 0 || credits > 12) continue;
    if (!/^[A-Za-z]+$/.test(dept)) continue;

    const prefix = dept.toUpperCase();
    const crn = `${currentPrefix2 || currentCenter}-${sectionCode}-${prefix}-${num}-${termCode}`;

    rows.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: prefix,
      course_number: num,
      course_title: title.trim(),
      credits,
      crn,
      days,
      start_time: start,
      end_time: end,
      start_date: estimateStartDate(termCode),
      location: loc.trim(),
      campus: currentCenter,
      mode: inferMode(mtype, loc),
      instructor: instructor.trim() || null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return rows;
}

function estimateStartDate(termCode: string): string {
  // OLC academic calendar: Fall starts ~Aug 24, Spring ~Jan 12, Summer ~Jun 1.
  const m = termCode.match(/^(fall|spring|summer|winter)-(\d{4})$/);
  if (!m) return "";
  const season = m[1];
  const year = m[2];
  if (season === "fall") return `${year}-08-24`;
  if (season === "spring") return `${year}-01-12`;
  if (season === "summer") return `${year}-06-01`;
  return `${year}-01-01`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olc-pdf-"));
  let grand = 0;
  for (const t of TERM_PDFS) {
    const pdfPath = path.join(tmp, `${t.termCode}.pdf`);
    console.log(`Downloading ${t.url}`);
    downloadPdf(t.url, pdfPath);
    if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size < 1000) {
      console.warn(`  skip — download failed or too small`);
      continue;
    }
    const text = pdfToText(pdfPath);
    const rows = parseRows(text, t.termCode, t.termLabel);
    const file = path.join(OUT_DIR, `${t.termCode}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`  ${t.termCode}: ${rows.length} sections → ${file}`);
    grand += rows.length;
  }
  console.log(`\n=== Oglala Lakota scrape complete: ${grand} sections ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
