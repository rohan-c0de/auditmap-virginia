/**
 * scrape-qcc-pdf-programs.ts — extract degree/certificate program
 * requirements for Quinsigamond Community College (MA) from their
 * combined PDF catalog.
 *
 * QCC publishes a single combined PDF rather than an Acalog/Smart
 * Catalog IQ/Coursedog/CourseLeaf instance. Their PDF — unlike
 * Massasoit's, which only has prose program descriptions — DOES
 * include structured curriculum tables with course codes, credits,
 * and "Total Credits Required" markers, so it's parseable.
 *
 * Each program block in the PDF is delimited by:
 *   1. A letter-spaced credential heading at column 0 of a page,
 *      e.g. "C E R T I F I C AT E - AC C"  or
 *           "A S S O C I AT E I N S C I E N C E - M P"
 *   2. The next 1-2 non-empty lines after that contain the program
 *      name, e.g. "Accounting Certificate" or "Manufacturing Technology".
 *   3. A "Course Title  Course #  Semester Offered  Credits  Prerequisites"
 *      table header introduces the curriculum table.
 *   4. Course rows follow, grouped by "Semester N (Fall|Spring|Summer)".
 *   5. The block ends at "Total Credits Required: N" (or "N-M").
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-qcc-pdf-programs.ts
 *   npx tsx scripts/ma/scrape-qcc-pdf-programs.ts --pdf=/tmp/qcc.pdf
 *   npx tsx scripts/ma/scrape-qcc-pdf-programs.ts --keep-text
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
} from "../../lib/types.js";

const COLLEGE_SLUG = "qcc";
const CATALOG_INDEX_URL =
  "https://www.qcc.edu/learn-qcc/catalog";
// Latest known PDF URL (2026-2027). Discovery scrapes the catalog index
// page to pick up new academic years automatically.
const FALLBACK_PDF_URL =
  "https://www.qcc.edu/sites/default/files/2026-04/2026-2027-catalog.pdf";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function getArg(name: string): string | null {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const flat = args.indexOf(`--${name}`);
  if (flat >= 0 && args[flat + 1] && !args[flat + 1].startsWith("--")) {
    return args[flat + 1];
  }
  return null;
}

const ARG_PDF_PATH = getArg("pdf");
const ARG_KEEP = process.argv.includes("--keep-text");

// ---------------------------------------------------------------------------
// Step 1: discover and download the latest catalog PDF
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

async function discoverPdfUrl(): Promise<string> {
  try {
    const html = await fetchText(CATALOG_INDEX_URL);
    const re =
      /href="((?:https?:\/\/[^"]*qcc\.edu)?\/sites\/default\/files\/[^"]+catalog\.pdf)"/gi;
    const matches: string[] = [];
    let m;
    while ((m = re.exec(html)) !== null) matches.push(m[1]);
    if (matches.length > 0) {
      const first = matches[0];
      return first.startsWith("http")
        ? first
        : `https://www.qcc.edu${first}`;
    }
  } catch (e) {
    console.warn(`  discovery failed (${e}); falling back to known URL`);
  }
  return FALLBACK_PDF_URL;
}

async function downloadPdf(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function pdfToText(pdfPath: string, txtPath: string): void {
  execFileSync("pdftotext", ["-layout", pdfPath, txtPath], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// ---------------------------------------------------------------------------
// Step 2: detect program-block boundaries
// ---------------------------------------------------------------------------

/**
 * Collapse letter-spaced text like "C E R T I F I C AT E - AC C" or
 * "A S S O C I AT E I N S C I E N C E - M P" into a normalized form
 * "CERTIFICATE - ACC" / "ASSOCIATE IN SCIENCE - MP".
 *
 * pdftotext puts a single space between each glyph in the spread-out
 * heading. Adjacent letters separated by single spaces get glued; double
 * spaces become a real word break. Hyphens are preserved.
 */
function normalizeSpacedHeading(line: string): string {
  // Replace any run of whitespace longer than 1 char with a sentinel "§"
  const sentineled = line.replace(/\s{2,}/g, "§");
  // Then drop single spaces (the inter-letter gaps), restore sentinels as " "
  const cleaned = sentineled.replace(/ /g, "").replace(/§/g, " ").trim();
  return cleaned;
}

const HEADING_RE =
  /^(CERTIFICATE|ASSOCIATEINSCIENCE|ASSOCIATEINARTS|ASSOCIATEINAPPLIEDSCIENCE|ASSOCIATEDEGREE|DIPLOMA)\s*-\s*([A-Z0-9]{1,8})\b/;

interface ProgramHeader {
  /** Line index in the full text where the heading appears. */
  startLine: number;
  /** "CERTIFICATE" / "ASSOCIATE IN SCIENCE" / etc. */
  rawCredential: string;
  /** Program code following the dash, e.g. "ACC", "MP", "EEBI". */
  programCode: string;
}

function findProgramHeaders(lines: string[]): ProgramHeader[] {
  const out: ProgramHeader[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip lines with significant leading whitespace — those are page
    // footers ("Q U I N SIGAM O N D ..."), not program headings.
    if (/^\s{20,}/.test(raw)) continue;
    const trimmed = raw.replace(/\s+$/, "");
    if (trimmed.length < 10) continue;
    const norm = normalizeSpacedHeading(trimmed);
    const m = norm.match(HEADING_RE);
    if (!m) continue;
    out.push({
      startLine: i,
      rawCredential: m[1],
      programCode: m[2],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 3: extract program name from the lines following the heading
// ---------------------------------------------------------------------------

/** Split a line at the first run of ≥5 spaces; return only the first column. */
function leftColumn(line: string): string {
  const m = line.match(/^(.*?)\s{5,}/);
  return (m ? m[1] : line).trim();
}

function extractProgramName(lines: string[], headerLine: number): string {
  // Look at the next 6 lines after the heading. The program name is on
  // the LEFT column of those lines; the right column is sidebar prose
  // ("Admissions Process", "Program Admissions Requirements", etc.).
  const candidates: string[] = [];
  for (let i = headerLine + 1; i < Math.min(headerLine + 7, lines.length); i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const left = leftColumn(l);
    if (!left) continue;
    // Skip generic side-text fragments and bullets. Use specific phrases
    // (multi-word) where possible — single keywords like "Transfer" can
    // legitimately appear in a program name (e.g. "Transfer Option").
    if (
      /^(Connections|Location|Ways to Take|Program Goals|Student Learning|Career Outlook|Transfer Articulations|Transfer Opportunities|Program Admissions|Admissions Process|Admissions Inquiries|Additional Cost|Technical Performance|Credit for Prior|CORI|Course Title|Semester|Total|The following|Upon|Students|These|This program|This certificate)\b/i.test(
        left,
      )
    )
      continue;
    if (/^•/.test(left)) continue;
    // Skip lines that look like prose (contain common sentence-only words).
    // Real program titles are noun phrases — they don't contain "that", "have",
    // "are", "will", etc. as standalone words.
    if (/\b(that|have|are|will|can be|should|provides|through)\b/i.test(left)) continue;
    candidates.push(left);
  }
  if (candidates.length === 0) return "";
  if (candidates.length === 1) return candidates[0];
  // QCC wraps long titles across two lines and sometimes three, e.g.:
  //   "Automation Robotics Manufacturing"
  //   "Technology Certificate (ARMTech)"
  // or:
  //   "Electronics Engineering Technology -"
  //   "Biomedical Instrumentation Option"
  // The first line's terminal character is the strongest signal: a trailing
  // " - " or a non-final descriptor like "Manufacturing" / "Engineering"
  // means the title continues. Build up until the title looks complete
  // (ends with a known terminator: Certificate, Option, Track, parenthetical).
  // Terminate on tokens that *only* appear at the end of program titles
  // (Certificate, Option, Track, Pathway). Words like "Management",
  // "Technology", "Studies" can appear mid-title (e.g. "Hospitality and
  // Recreation Management - Foodservice Management Option") so we don't
  // include those.
  const TERMINATORS =
    /(Certificate(?:\s*\([^)]+\))?|\bOption|\bTrack|\bPathway|\bDiploma)\s*$/i;
  let title = candidates[0];
  for (let k = 1; k < Math.min(candidates.length, 4); k++) {
    if (TERMINATORS.test(title)) break;
    title = `${title} ${candidates[k]}`;
  }
  return title.replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Step 4: parse the curriculum table for a program block
// ---------------------------------------------------------------------------

interface CurriculumResult {
  courses: RequiredCourse[];
  totalCredits: number | null;
}

// A course row has the layout (column indices vary per page but the
// structure is consistent enough):
//   <Title spanning multiple words/lines>  PREFIX NUM   SEMESTERS   CREDITS   <prereqs?>
// Where SEMESTERS is e.g. "F/S/SU" or "F/S" or "S".
//
// We parse by finding lines that contain a course code anchor `^([A-Z]{3})\s+(\d{3,4})\b`
// after some leading title text. The credit value is the next standalone
// integer after the semester offering. Multi-line titles (where the title
// wraps to a previous line) are stitched via a 1-line lookback.
const COURSE_LINE_RE =
  /^(.+?)\s{2,}([A-Z]{3})\s+(\d{3,4}[A-Z]?)\s+([FSU/]+)?\s*([0-9]+(?:-[0-9]+)?)?/;

function parseCurriculum(
  lines: string[],
  startLine: number,
  endLine: number,
): CurriculumResult {
  const courses: RequiredCourse[] = [];
  const seen = new Set<string>();
  let totalCredits: number | null = null;

  // Walk lines from startLine to endLine, looking for course rows.
  // QCC's tables can wrap a long course title onto a previous line.
  let prevTitleFragment = "";
  for (let i = startLine; i < endLine; i++) {
    const line = lines[i];
    if (!line.trim()) {
      prevTitleFragment = "";
      continue;
    }

    // Total Credits Required line — capture and stop walking on this block.
    const totalMatch = line.match(
      /Total Credits Required:?\s*(\d+)(?:\s*-\s*(\d+))?/i,
    );
    if (totalMatch) {
      totalCredits = parseInt(totalMatch[2] ?? totalMatch[1], 10);
      break;
    }

    // Match a course row. Title can include parentheses, slashes, etc.
    const m = line.match(COURSE_LINE_RE);
    if (!m) {
      // Save as potential title-fragment for the next line (in case the
      // course code is on a continuation line).
      const t = line.trim();
      if (t && !/^(Semester|Total|Course Title|Apply|Register|Meet|For the|Submit|All)/i.test(t)) {
        prevTitleFragment = prevTitleFragment ? `${prevTitleFragment} ${t}` : t;
      }
      continue;
    }

    let title = m[1].trim();
    const prefix = m[2];
    const number = m[3];
    const credits = m[5] ? parseInt(m[5], 10) : 0;

    // If we have a saved title fragment from a previous line, prepend it.
    if (prevTitleFragment && title.length < 30) {
      title = `${prevTitleFragment} ${title}`.replace(/\s+/g, " ").trim();
    }
    prevTitleFragment = "";

    // Skip non-course rows (e.g. "Total" lines, semester headers)
    if (/^(Total|Semester|Course)$/i.test(title)) continue;
    // Skip placeholder rows ("ACC Program Specific Elective ---") — title
    // ends with "Elective" and the dashes show up as a literal "---" in the
    // course code position. Filter by checking that `prefix` doesn't equal
    // "---" — but our regex requires uppercase letters, so "---" won't match.
    // Still, the title might be a generic placeholder; skip those.
    if (/Elective\s*$/i.test(title) && /^([A-Z]{3})\s+/.test(title) === false) {
      // It's a placeholder like "ACC Program Specific Elective" with code
      // "---". Allow the row through but flag as a generic elective.
      // Actually, since the regex matched, we have a real course — keep it.
    }

    const key = `${prefix} ${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    courses.push({
      prefix,
      number,
      title: title.replace(/\s+/g, " ").trim(),
      credits,
      or_alternatives: [],
    });
  }

  return { courses, totalCredits };
}

// ---------------------------------------------------------------------------
// Step 5: classify credential
// ---------------------------------------------------------------------------

function classifyCredential(
  rawCredential: string,
  programName: string,
): ProgramCredential {
  const r = rawCredential;
  if (r === "ASSOCIATEINAPPLIEDSCIENCE") return "AAS";
  if (r === "ASSOCIATEINARTS") return "AA";
  if (r === "ASSOCIATEINSCIENCE") return "AS";
  if (r === "ASSOCIATEDEGREE") {
    if (/applied/i.test(programName)) return "AAS";
    if (/arts/i.test(programName)) return "AA";
    return "AS";
  }
  if (r === "DIPLOMA") return "diploma";
  if (r === "CERTIFICATE") return "certificate";
  return "other";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tmp = os.tmpdir();
  const pdfPath = ARG_PDF_PATH ?? path.join(tmp, "qcc-catalog.pdf");
  const txtPath = path.join(tmp, "qcc-catalog.txt");

  let catalogUrl: string;
  if (ARG_PDF_PATH) {
    catalogUrl = CATALOG_INDEX_URL;
    console.log(`Using local PDF: ${pdfPath}`);
  } else {
    console.log("Discovering latest QCC catalog PDF...");
    catalogUrl = await discoverPdfUrl();
    console.log(`  PDF URL: ${catalogUrl}`);
    console.log(`  Downloading -> ${pdfPath}`);
    await downloadPdf(catalogUrl, pdfPath);
  }

  console.log(`Running pdftotext -layout -> ${txtPath}`);
  pdfToText(pdfPath, txtPath);

  const text = fs.readFileSync(txtPath, "utf8");
  const lines = text.split(/\r?\n/);
  console.log(`  Loaded ${lines.length} lines of text`);

  const headers = findProgramHeaders(lines);
  console.log(`  Found ${headers.length} program-block headers`);

  const programs: ProgramRequirement[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].startLine : lines.length;
    const programName = extractProgramName(lines, h.startLine);
    if (!programName) continue;
    const { courses, totalCredits } = parseCurriculum(
      lines,
      h.startLine + 1,
      nextStart,
    );
    if (courses.length === 0) continue;

    const credential = classifyCredential(h.rawCredential, programName);
    programs.push({
      title: programName,
      credential,
      program_code: h.programCode,
      catalog_url: catalogUrl,
      total_credits: totalCredits,
      gpa_minimum: 2.0,
      description: null,
      requirement_groups: [
        {
          name: "Recommended Course Sequence",
          credits_required: totalCredits,
          choose_n: null,
          courses,
        },
      ],
      matched_program_slug: null,
    });
  }

  console.log(`  Parsed ${programs.length} programs`);

  const { matched, unmatched } = applyProgramMatching(programs);
  console.log(
    `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
  );

  // Determine catalog year from URL or filename if possible
  const yearMatch = catalogUrl.match(/(\d{4})-(\d{4})/);
  const catalogYear = yearMatch ? `${yearMatch[1]}-${yearMatch[2]}` : "";

  const data: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: catalogYear,
    catalog_url: catalogUrl,
    scraped_at: new Date().toISOString(),
    programs,
  };

  const outDir = path.join(process.cwd(), "data", "ma", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${COLLEGE_SLUG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\n✓ Wrote ${programs.length} programs to ${outPath}`);

  if (!ARG_KEEP) {
    fs.unlinkSync(txtPath);
  } else {
    console.log(`  text kept at ${txtPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
