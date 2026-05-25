/**
 * scrape-seark-pdf-programs.ts — Extract degree/certificate programs from
 * Southeast Arkansas College's 2025-2026 catalog PDF.
 *
 * Strategy
 * ────────
 * SEARK publishes its catalog as a single PDF with no machine-readable
 * structure (no TOC anchors, no tagged PDF). We use pdftotext -layout
 * (poppler-utils) to preserve column spacing, then parse the flat text:
 *
 *   1. Detect program start lines — either:
 *      a. "Suggested Program of Study – <degree title>" on one line, or
 *      b. A degree-type title line (e.g. "Technical Certificate in HVAC")
 *         within ~20 lines before a bare "Suggested Program of Study" line.
 *
 *   2. Scan forward from each program start, collecting course lines.
 *      Course line format (pdftotext -layout output):
 *        "    PREFIX NNNN[ –] Title words                      N"
 *      where PREFIX is 2–6 uppercase letters, NNNN is 3–5 digits, and N
 *      is the integer credit count right-justified at line end.
 *
 *   3. Stop collecting at the next program marker or a section-end
 *      sentinel ("Completion of … TC/AAS", "Division of …", page 90+).
 *
 * Output: data/ar/programs/southeast-arkansas-college.json in the same
 * schema as scrapeAcalogPrograms output (used by scrape-programs.ts).
 *
 * Prerequisite:
 *   pdftotext (poppler-utils) must be installed:
 *     brew install poppler   (macOS)
 *     apt install poppler-utils  (Linux)
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-seark-pdf-programs.ts
 *   npx tsx scripts/ar/scrape-seark-pdf-programs.ts --pdf /tmp/seark-cat.pdf
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { applyProgramMatching } from "../../lib/programs/matcher.js";

const STATE = "ar";
const COLLEGE_SLUG = "southeast-arkansas-college";
const CATALOG_URL = "https://www.seark.edu/sites/default/files/catalogs/2025-2026_Seark_Catalog.pdf";
const CATALOG_YEAR = "2025-2026";

// ── Credential detection ──────────────────────────────────────────────────────

interface DegreeType {
  pattern: RegExp;
  credential: string;
}

const DEGREE_TYPES: DegreeType[] = [
  { pattern: /Associate of Arts in Teaching/i, credential: "AAT" },
  { pattern: /Associate of Applied Science/i, credential: "AAS" },
  { pattern: /Associate of Arts in General Education/i, credential: "AA" },
  { pattern: /Associate of General Studies/i, credential: "AGS" },
  { pattern: /Associate of Arts/i, credential: "AA" },
  { pattern: /Technical Certificate/i, credential: "TC" },
  { pattern: /Certificate of Proficiency/i, credential: "CP" },
  { pattern: /Certificate of General Studies/i, credential: "CGS" },
  { pattern: /Certificate of Arts/i, credential: "CA" },
  // Compact forms: "Business Analytics, AAS" / "PC Maintenance & Repair"
  { pattern: /,\s*AAS\b/i, credential: "AAS" },
  { pattern: /,\s*AA\b/i, credential: "AA" },
  { pattern: /,\s*TC\b/i, credential: "TC" },
  { pattern: /,\s*CP\b/i, credential: "CP" },
];

function detectCredential(title: string): string {
  for (const { pattern, credential } of DEGREE_TYPES) {
    if (pattern.test(title)) return credential;
  }
  return "AAS"; // safe default for technical programs
}

function isDegreeTitle(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 5) return false;
  // Must contain a degree-type keyword
  if (!DEGREE_TYPES.some(({ pattern }) => pattern.test(t))) return false;
  // Must look like a title, not a description:
  //   - under 120 chars
  //   - does not start with "The " or "This "
  //   - does not end with a period (description sentence)
  //   - does not start with lowercase
  if (t.length > 120) return false;
  if (/^(The |This |Students |In |Upon |A [A-Z])/i.test(t)) return false;
  if (t.endsWith(".")) return false;
  return true;
}

// ── Course line regex ─────────────────────────────────────────────────────────
// Matches lines like:
//   "    COMP 1123 Introduction to Computers                       3"
//   "    AIRC 1114 – Basic Refrigeration                           4"
//   "    MATH 1323 – Real World Math or MATH 1333 – College Algebra 3"
//   (note: last case has two course codes on one line — rare but handled)
const COURSE_LINE_RE =
  /\b([A-Z]{2,6})\s+(\d{3,5}[A-Z]?)\s*(?:[–\-]\s*)?(.*?)?\s+(\d{1,2})\s*$/;

// Sentinel lines — stop collecting courses when we see these.
// Note: "Page N" is intentionally excluded — programs span page breaks.
// Anchored to line-start (trimmed) to avoid false positives on course lines
// like "Pre-Admission Requirements BIOL 2454 – ..." which contain "ADMISSION".
const STOP_SENTINELS = [
  /^\s*Division of /i,
  /^\s*Faculty:/i,
  /^ADMISSION REQUIREMENTS$/i,
  /^APPLICATION PROCEDURE$/i,
  /^ACCEPTANCE PROCEDURE$/i,
];

function isSentinel(line: string): boolean {
  const t = line.trim();
  return STOP_SENTINELS.some((re) => re.test(t));
}

// ── Core interfaces (mirror scrapeAcalogPrograms output) ─────────────────────

interface CourseEntry {
  prefix: string;
  number: string;
  title: string;
  credits: number | null;
  or_alternatives: CourseEntry[];
}

interface RequirementGroup {
  name: string;
  credits_required: number | null;
  choose_n: number | null;
  courses: CourseEntry[];
}

interface Program {
  title: string;
  credential: string;
  program_code: null;
  catalog_url: string;
  total_credits: number | null;
  gpa_minimum: null;
  description: null;
  requirement_groups: RequirementGroup[];
}

interface ProgramsOutput {
  college_slug: string;
  catalog_year: string;
  catalog_url: string;
  scraped_at: string;
  programs: Program[];
}

// ── PDF → text conversion ─────────────────────────────────────────────────────

function pdfToText(pdfPath: string): string {
  // -layout preserves column spacing; -nopgbrk keeps page breaks as form feeds
  try {
    const result = execSync(`pdftotext -layout "${pdfPath}" -`, {
      maxBuffer: 20 * 1024 * 1024,
    });
    return result.toString("utf8");
  } catch (e) {
    throw new Error(`pdftotext failed: ${(e as Error).message}\n` +
      `Install with: brew install poppler  (macOS) or apt install poppler-utils`);
  }
}

// ── Text parsing ──────────────────────────────────────────────────────────────

/**
 * Main parse function. Returns a list of Program objects extracted from the
 * flat pdftotext output.
 */
function parsePrograms(text: string): Program[] {
  const rawLines = text.split("\n");

  // Normalise: collapse runs of spaces inside course lines only when the
  // prefix+number pattern is visible (avoids disturbing layout cues).
  const lines = rawLines.map((l) => {
    // Replace form-feed (page break) chars with empty line
    return l.replace(/\f/g, "");
  });

  const programs: Program[] = [];

  /**
   * Scan lines[] starting at index `start` and collect all course entries
   * until we hit the next program start or a stop sentinel.
   * Returns { courses, totalCredits, endIdx }.
   */
  function collectCourses(start: number): {
    courses: CourseEntry[];
    totalCredits: number | null;
    endIdx: number;
  } {
    const courses: CourseEntry[] = [];
    let totalCredits: number | null = null;
    let i = start;
    let blankStreak = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const t = raw.trim();

      // Detect program end
      if (isSentinel(raw)) break;

      // "Suggested Program of Study" signals the next program — stop only
      // once we've collected courses (avoids breaking on the current program's
      // own header, which was already consumed by the outer loop).
      if (
        /^(?:Suggested|Required|Requiired|Optional)\s+Program of Study|^Program of Study\s*$/i.test(t) &&
        courses.length > 0
      ) {
        break;
      }

      // Detect total credit line
      const totalMatch = t.match(
        /Total Program Credit Hours[:\s]*(\d{1,3})|Completion of .+?\b(\d{1,3})\s*$/i
      );
      if (totalMatch) {
        totalCredits = parseInt(totalMatch[1] ?? totalMatch[2], 10);
        i++;
        continue;
      }

      // Skip semester headers, totals, notes, page markers
      if (
        /^(Year\s+\d|1st Year|2nd Year|Extended Summer|Pre-Admission|Semester Total|Year \d Total|Semester [1-9]|Required Courses|^Credit Hours$|^Course$|Year\s*\/\s*Semester|^Note|^\*|^Page \d+$|Choose ONE|Choose one|^Hours$|^Credit$)/i.test(t)
      ) {
        blankStreak = 0;
        i++;
        continue;
      }

      // Blank line counter — stop after 8 consecutive blanks (major section gap).
      // We use a high threshold because page breaks produce 2-3 blank lines and
      // some tables have large gaps between sections.
      if (!t) {
        blankStreak++;
        if (blankStreak >= 8 && courses.length > 0) break;
        i++;
        continue;
      }
      blankStreak = 0;

      // Try to match a course line
      const cm = raw.match(COURSE_LINE_RE);
      if (cm) {
        const prefix = cm[1];
        const number = cm[2];
        let title = (cm[3] ?? "").trim().replace(/\s{2,}/g, " ").replace(/^[–\-]\s*/, "");
        const credits = parseInt(cm[4], 10);

        // If title is empty (split-line case), try next line
        if (!title && i + 1 < lines.length) {
          const nextTrimmed = lines[i + 1].trim();
          // Next line is continuation if it doesn't look like a course/header
          if (nextTrimmed && !COURSE_LINE_RE.test(lines[i + 1]) && nextTrimmed.length > 2) {
            title = nextTrimmed;
            i++; // consume the continuation line
          }
        }

        // Deduplicate identical course entries (some programs repeat courses
        // across semesters as pre-req notes)
        const key = `${prefix}|${number}`;
        const existing = courses.find(
          (c) => c.prefix === prefix && c.number === number
        );
        if (!existing) {
          courses.push({
            prefix,
            number,
            title,
            credits: isNaN(credits) ? null : credits,
            or_alternatives: [],
          });
        }
        i++;
        continue;
      }

      i++;
    }

    return { courses, totalCredits, endIdx: i };
  }

  // ── Pass 1: identify program anchor lines ─────────────────────────────────
  // An anchor is either:
  //   A) "Suggested Program of Study – <title>" (inline title)
  //   B) A bare "Suggested Program of Study" preceded by a degree-title line

  const STUDY_RE =
    /^(?:Suggested|Required|Requiired|Optional)\s+Program of Study|^Program of Study\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!STUDY_RE.test(t)) continue;

    // Extract title
    let title: string | null = null;

    // Case A: inline — "Suggested Program of Study – Associate of Arts"
    const inlineMatch = t.match(/Program of Study\s*[–\-]\s*(.+)/i);
    if (inlineMatch) {
      title = inlineMatch[1].trim();
    } else {
      // Case B: look backward up to 25 lines for the most-recent degree title
      for (let j = i - 1; j >= Math.max(0, i - 25); j--) {
        const prev = lines[j].trim();
        if (!prev) continue;
        if (isDegreeTitle(prev)) {
          title = prev;
          break;
        }
        // If we hit another "Suggested Program" going backward, stop
        if (STUDY_RE.test(prev)) break;
      }
    }

    if (!title) continue; // couldn't identify a program title — skip

    // Skip duplicates (same title, same position)
    if (programs.some((p) => p.title === title)) {
      // Different section of the same program (e.g. course list continues on
      // next page) — merge courses into the last same-title program.
    }

    const credential = detectCredential(title);

    // Collect courses from line after the header
    const { courses, totalCredits } = collectCourses(i + 1);

    if (courses.length === 0) continue; // header without a course list

    // Merge into existing program with same title, or create new
    const existing = programs.find((p) => p.title === title);
    if (existing) {
      // Merge courses (deduplicate by prefix+number)
      for (const c of courses) {
        if (!existing.requirement_groups[0].courses.find(
          (ec) => ec.prefix === c.prefix && ec.number === c.number
        )) {
          existing.requirement_groups[0].courses.push(c);
        }
      }
      if (totalCredits && !existing.total_credits) {
        existing.total_credits = totalCredits;
      }
    } else {
      programs.push({
        title,
        credential,
        program_code: null,
        catalog_url: CATALOG_URL,
        total_credits: totalCredits,
        gpa_minimum: null,
        description: null,
        requirement_groups: [
          {
            name: "Program Requirements",
            credits_required: totalCredits,
            choose_n: null,
            courses,
          },
        ],
      });
    }
  }

  return programs;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const pdfIdx = args.indexOf("--pdf");
  let pdfPath = pdfIdx >= 0 ? args[pdfIdx + 1] : "/tmp/seark-cat.pdf";

  // Download the PDF if it doesn't exist
  if (!fs.existsSync(pdfPath)) {
    console.log(`Downloading SEARK catalog PDF → ${pdfPath}`);
    try {
      execSync(
        `curl -sL -o "${pdfPath}" "${CATALOG_URL}"`,
        { stdio: ["ignore", "ignore", "inherit"] }
      );
    } catch {
      throw new Error(`Failed to download PDF from ${CATALOG_URL}`);
    }
  }

  console.log(`Converting PDF to text: ${pdfPath}`);
  const text = pdfToText(pdfPath);
  console.log(`  ${text.split("\n").length} lines`);

  console.log("Parsing programs...");
  const programs = parsePrograms(text);
  console.log(`  Found ${programs.length} programs`);
  const { matched, unmatched } = applyProgramMatching(programs as never);
  console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);

  if (programs.length === 0) {
    console.error("No programs found — check PDF path and pdftotext output.");
    process.exit(1);
  }

  // Print summary
  const byCredential: Record<string, number> = {};
  for (const p of programs) {
    byCredential[p.credential] = (byCredential[p.credential] ?? 0) + 1;
  }
  for (const [cred, count] of Object.entries(byCredential).sort()) {
    console.log(`  ${cred}: ${count}`);
  }

  const totalCourseRefs = programs.reduce(
    (sum, p) => sum + p.requirement_groups[0].courses.length,
    0
  );
  console.log(`  Total course references: ${totalCourseRefs}`);

  // Write output
  const outDir = path.join(process.cwd(), "data", STATE, "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${COLLEGE_SLUG}.json`);

  const output: ProgramsOutput = {
    college_slug: COLLEGE_SLUG,
    catalog_year: CATALOG_YEAR,
    catalog_url: CATALOG_URL,
    scraped_at: new Date().toISOString(),
    programs,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Wrote ${programs.length} programs → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
