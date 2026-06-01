/**
 * scrape-jscc-pdf-programs.ts — extract degree/certificate program
 * requirements for Jackson State Community College (TN) from their
 * PDF-only catalog.
 *
 * JSCC is the one TBR community college that doesn't publish an Acalog
 * catalog (other than Roane State, which is excluded for SAML reasons).
 * Their catalog is distributed as a single combined PDF. This scraper
 * downloads the latest PDF, runs `pdftotext -layout`, and parses the
 * "Program Requirements" → "Sample Schedule" sections into the same
 * CollegePrograms shape the Acalog scraper produces.
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/tn/scrape-jscc-pdf-programs.ts
 *   npx tsx scripts/tn/scrape-jscc-pdf-programs.ts --pdf=/tmp/jscc.pdf
 *   npx tsx scripts/tn/scrape-jscc-pdf-programs.ts --keep-text   # keep /tmp/.txt for inspection
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
  RequirementGroup,
} from "../../lib/types.js";

const COLLEGE_SLUG = "jackson-state";
const CATALOG_INDEX_URL =
  "https://www.jscc.edu/academics/academic-services/course-catalog/";
// The combined catalog PDF link is published on the catalog index page.
// Falls back to a known-good 2025-26 URL if discovery fails.
const FALLBACK_PDF_URL =
  "https://jscc.edu/media/jackson-state/content-assets/documents/academics-/academic-catalogs/25.26-catalog6.24_compressed_Combined.pdf";

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
    // Pick the first absolute or relative href that looks like a JSCC catalog PDF
    const re =
      /href="((?:https:\/\/jscc\.edu)?\/media\/jackson-state\/content-assets\/documents\/academics-?\/academic-catalogs\/[^"]+\.pdf)"/gi;
    const matches: string[] = [];
    let m;
    while ((m = re.exec(html)) !== null) matches.push(m[1]);
    if (matches.length > 0) {
      const first = matches[0];
      return first.startsWith("http") ? first : `https://jscc.edu${first}`;
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

// ---------------------------------------------------------------------------
// Step 2: pdftotext
// ---------------------------------------------------------------------------

function pdfToText(pdfPath: string, txtPath: string): void {
  execFileSync("pdftotext", ["-layout", pdfPath, txtPath], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// ---------------------------------------------------------------------------
// Step 3: parse credential from a "for the X: Title" header line
// ---------------------------------------------------------------------------

function parseCredentialAndTitle(
  forTheLine: string,
): { credential: ProgramCredential; title: string } | null {
  // Strip leading whitespace and the "for the " prefix
  const m = forTheLine.match(/^\s*for the (.+)$/);
  if (!m) return null;
  const rest = m[1].trim();
  // Patterns we see in the JSCC catalog:
  //   "Associate of Science: Accounting"
  //   "Associate of Arts: Art"
  //   "Associate of Arts/Science: Criminal Justice"
  //   "Associate of Science in Teaching"
  //   "Associate of Applied Science: Business--Management"
  let credential: ProgramCredential = "other";
  let title = rest;
  if (/^Associate of Applied Science\b/i.test(rest)) {
    credential = "AAS";
    title = rest.replace(/^Associate of Applied Science[: ]+/i, "").trim();
  } else if (/^Associate of Arts\/Science\b/i.test(rest)) {
    credential = "AA"; // hybrid AA/AS — pick AA, the more permissive label
    title = rest.replace(/^Associate of Arts\/Science[: ]+/i, "").trim();
  } else if (/^Associate of Arts\b/i.test(rest)) {
    credential = "AA";
    title = rest.replace(/^Associate of Arts[: ]+/i, "").trim();
  } else if (/^Associate of Science in Teaching\b/i.test(rest)) {
    credential = "AS";
    title = "Teaching";
  } else if (/^Associate of Science\b/i.test(rest)) {
    credential = "AS";
    title = rest.replace(/^Associate of Science[: ]+/i, "").trim();
  } else if (/Certificate\b/i.test(rest)) {
    credential = "certificate";
  }
  // Replace double-dashes with em-style separator
  title = title.replace(/\s*--\s*/g, " — ");
  if (!title) return null;
  return { credential, title };
}

// ---------------------------------------------------------------------------
// Step 4: parse a course-row line for one or more PREFIX NUMBER ... HRS tuples
// ---------------------------------------------------------------------------

const COURSE_RE =
  /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)(?:\/\d{3,4}[A-Z]?)?\s+([A-Za-z][A-Za-z0-9 \-/&,'.]{2,80}?)\s{2,}(\d+)(?=\s|$)/g;

// Drop XXXX placeholders ("HIST XXXX", "MATH XXXX", etc.)
function isPlaceholderNumber(num: string): boolean {
  return /^X{3,}$/i.test(num);
}

interface ParsedCourseRow {
  prefix: string;
  number: string;
  title: string;
  credits: number;
}

function parseCourseRows(line: string): ParsedCourseRow[] {
  const out: ParsedCourseRow[] = [];
  COURSE_RE.lastIndex = 0;
  let m;
  while ((m = COURSE_RE.exec(line)) !== null) {
    const [, prefix, number, title, credits] = m;
    if (isPlaceholderNumber(number)) continue;
    // Filter out obvious non-course matches (e.g. "TBR 2046")
    if (prefix === "TBR" || prefix === "PDF" || prefix === "ID") continue;
    out.push({
      prefix,
      number,
      title: title.trim(),
      credits: parseInt(credits, 10),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: parse total credits from "(The X requires N - M college level credits...)"
// ---------------------------------------------------------------------------

function parseTotalCredits(line: string): number | null {
  const m = line.match(
    /requires\s+(\d+)(?:\s*-\s*(\d+))?\s+college level credits/i,
  );
  if (!m) return null;
  // If a range, take the upper bound (it's the maximum students may need)
  return parseInt(m[2] ?? m[1], 10);
}

// ---------------------------------------------------------------------------
// Step 6: walk the text, building ProgramRequirement entries
// ---------------------------------------------------------------------------

interface ProgramBlock {
  startLine: number;
  forTheLine: number;
  forThe: string;
}

function findProgramBlocks(lines: string[]): ProgramBlock[] {
  const blocks: ProgramBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Program Requirements\s*$/.test(lines[i])) {
      // The "for the X" line is usually 1 to 3 lines below for AS/AA programs,
      // but AAS program pages insert blank lines and a "Professional and
      // Technical Programs" running header — search up to 12 lines.
      for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
        if (/^\s*for the [A-Z]/.test(lines[j])) {
          blocks.push({ startLine: i, forTheLine: j, forThe: lines[j] });
          break;
        }
      }
    }
  }
  return blocks;
}

const STOP_SENTINELS = [
  /^Career and Salary Information/i,
  /^Projected Income/i,
  /^Additional Information/i,
  /^Contact Information/i,
  /^Note:/i,
  /JACKSON STATE COMMUNITY COLLEGE\s*$/,
  /^Program Requirements\s*$/,
  /^Technical Certificate/i,
];

function isStop(line: string): boolean {
  return STOP_SENTINELS.some((re) => re.test(line.trim()));
}

function dedupCourses(courses: RequiredCourse[]): RequiredCourse[] {
  const seen = new Set<string>();
  const out: RequiredCourse[] = [];
  for (const c of courses) {
    const key = `${c.prefix} ${c.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function buildProgramFromBlock(
  lines: string[],
  block: ProgramBlock,
  catalogUrl: string,
): ProgramRequirement | null {
  const meta = parseCredentialAndTitle(block.forThe);
  if (!meta) return null;

  // Look for "(... requires N credits)" within ~10 lines after the for-the header
  let totalCredits: number | null = null;
  for (
    let i = block.forTheLine + 1;
    i < Math.min(block.forTheLine + 12, lines.length);
    i++
  ) {
    const c = parseTotalCredits(lines[i]);
    if (c !== null) {
      totalCredits = c;
      break;
    }
  }

  // Find Sample Schedule header within ~250 lines after the program header
  let scheduleStart = -1;
  for (
    let i = block.forTheLine + 1;
    i < Math.min(block.forTheLine + 260, lines.length);
    i++
  ) {
    if (/Sample Schedule\s*$/.test(lines[i])) {
      scheduleStart = i + 1;
      break;
    }
  }
  if (scheduleStart < 0) return null;

  // Walk the schedule, collecting course rows until we hit a stop sentinel,
  // a long blank stretch, or another Program Requirements header.
  const courses: RequiredCourse[] = [];
  let blankRun = 0;
  for (let i = scheduleStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      blankRun++;
      if (blankRun >= 6) break; // 6 consecutive blanks = end of schedule
      continue;
    }
    blankRun = 0;
    if (isStop(line)) break;
    const rows = parseCourseRows(line);
    for (const r of rows) {
      courses.push({
        prefix: r.prefix,
        number: r.number,
        title: r.title,
        credits: r.credits,
        or_alternatives: [],
      });
    }
    // Cap to avoid runaway capture (typical schedule is 4 semesters of 5 courses)
    if (i - scheduleStart > 200) break;
  }

  if (courses.length === 0) return null;
  const deduped = dedupCourses(courses);

  const requirementGroup: RequirementGroup = {
    name: "Recommended Course Sequence",
    credits_required: totalCredits,
    choose_n: null,
    courses: deduped,
  };

  return {
    title: meta.title,
    credential: meta.credential,
    program_code: null,
    catalog_url: catalogUrl,
    total_credits: totalCredits,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: [requirementGroup],
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Step 7: parse Technical Certificate programs (different layout than degrees)
// ---------------------------------------------------------------------------
//
// Each certificate has a header line ending in "Certificate", followed
// (within ~6 lines) by a "Rubric / Course / Hrs" header and then a table.
// We capture rows up to a "Total Credits" line.

function extractCertificateTitlesFromLine(line: string): string[] {
  // A certificate title is typically Title-Case words ending in "Certificate".
  // Some lines have two side-by-side titles (two-column layout).
  const titles: string[] = [];
  const re =
    /([A-Z][A-Za-z0-9 &/'-]+?Certificate)(?=\s{2,}|$)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const t = m[1].trim();
    if (t.length < 6 || t.length > 80) continue;
    if (/^Technical Certificate of Credit$/i.test(t)) continue;
    if (/^Career Technical Certificate$/i.test(t)) continue;
    if (/^Academic Certificate$/i.test(t)) continue;
    if (/^Tennessee.+Technical Certificate$/i.test(t)) continue;
    titles.push(t);
  }
  return titles;
}

function buildCertificateProgram(
  lines: string[],
  startIdx: number,
  title: string,
  catalogUrl: string,
): ProgramRequirement | null {
  // Find the next Rubric/Course/Hrs header within ~20 lines (some certs have
  // a description paragraph before the table).
  let tableStart = -1;
  for (let j = startIdx + 1; j < Math.min(startIdx + 25, lines.length); j++) {
    if (/Rubric\s+Course\s+Hrs/.test(lines[j])) {
      tableStart = j + 1;
      break;
    }
  }
  if (tableStart < 0) return null;

  const courses: RequiredCourse[] = [];
  let totalCredits: number | null = null;
  for (let j = tableStart; j < Math.min(tableStart + 40, lines.length); j++) {
    const line = lines[j];
    const tcMatch = line.match(/Total Credits\s+(\d+)/);
    if (tcMatch) {
      totalCredits = parseInt(tcMatch[1], 10);
      break;
    }
    const rows = parseCourseRows(line);
    for (const r of rows) {
      courses.push({
        prefix: r.prefix,
        number: r.number,
        title: r.title,
        credits: r.credits,
        or_alternatives: [],
      });
    }
  }
  if (courses.length === 0) return null;

  return {
    title,
    credential: "certificate",
    program_code: null,
    catalog_url: catalogUrl,
    total_credits: totalCredits,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: [
      {
        name: "Required Courses",
        credits_required: totalCredits,
        choose_n: null,
        courses: dedupCourses(courses),
      },
    ],
    matched_program_slug: null,
  };
}

function parseCertificates(
  lines: string[],
  catalogUrl: string,
): ProgramRequirement[] {
  const certs: ProgramRequirement[] = [];
  for (let i = 0; i < lines.length; i++) {
    const titles = extractCertificateTitlesFromLine(lines[i]);
    for (const title of titles) {
      const program = buildCertificateProgram(lines, i, title, catalogUrl);
      if (program) certs.push(program);
    }
  }
  // Dedup certificate programs by title (the same cert can appear multiple
  // times across the catalog; keep the entry with the most courses).
  const byTitle = new Map<string, ProgramRequirement>();
  for (const c of certs) {
    const existing = byTitle.get(c.title);
    if (
      !existing ||
      existing.requirement_groups[0].courses.length <
        c.requirement_groups[0].courses.length
    ) {
      byTitle.set(c.title, c);
    }
  }
  return Array.from(byTitle.values());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tmp = os.tmpdir();
  const pdfPath = ARG_PDF_PATH ?? path.join(tmp, "jscc-catalog.pdf");
  const txtPath = path.join(tmp, "jscc-catalog.txt");

  let catalogUrl: string;
  if (ARG_PDF_PATH) {
    catalogUrl = CATALOG_INDEX_URL;
    console.log(`Using local PDF: ${pdfPath}`);
  } else {
    console.log("Discovering latest JSCC catalog PDF...");
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

  // Parse Associate degree programs
  const blocks = findProgramBlocks(lines);
  console.log(`  Found ${blocks.length} "Program Requirements" blocks`);
  const degreePrograms: ProgramRequirement[] = [];
  for (const block of blocks) {
    const p = buildProgramFromBlock(lines, block, catalogUrl);
    if (p) degreePrograms.push(p);
  }
  console.log(`  Parsed ${degreePrograms.length} degree programs`);

  // Parse Technical Certificate programs
  const certPrograms = parseCertificates(lines, catalogUrl);
  console.log(`  Parsed ${certPrograms.length} certificate programs`);

  const programs = [...degreePrograms, ...certPrograms];

  // Run program-slug matcher
  const { matched, unmatched } = applyProgramMatching(programs);
  console.log(
    `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
  );

  // Determine catalog year from URL or filename if possible
  const yearMatch = catalogUrl.match(/(\d{2})[.-](\d{2})/);
  const catalogYear = yearMatch
    ? `20${yearMatch[1]}-20${yearMatch[2]}`
    : "";

  const data: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: catalogYear,
    catalog_url: catalogUrl,
    scraped_at: new Date().toISOString(),
    programs,
  };

  const outDir = path.join(process.cwd(), "data", "tn", "programs");
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
