/**
 * scrape-tcsg-pdf-programs.ts — extract programs from PDF-only TCSG catalogs.
 *
 * Two GA TCSG colleges publish their academic catalog as PDF only with no
 * structured web catalog: Central GA Tech and North GA Tech. Both follow
 * TCSG conventions (uniform program-code format like AC13, course codes like
 * "ENGL 1101", consistent layout per college) but the actual PDF formatting
 * differs enough that we maintain a parser variant for each.
 *
 * Two parser variants are implemented:
 *
 *   ngtc   — North GA Tech "Programs of Study" chapter PDF.
 *            Headers: "Accounting AAS Degree (AC13)"
 *            Total credits: "Credit Hours Required for Graduation. ... 64"
 *            Course rows: "ACCT 1100 Financial Accounting I    4"
 *            End marker: "Estimated cost of books..."
 *
 *   cgtc   — Central GA Tech "Catalog & Student Handbook" PDF.
 *            Headers (two-line): "HEAVY DIESEL SERVICE TECHNICIAN (HD31)"
 *                              followed by  "Technical Certificate of Credit"
 *            Total credits: "Minimum Total Hours 32" or "Total Hours 43"
 *            Course rows: same shape as NGTC.
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-tcsg-pdf-programs.ts
 *   npx tsx scripts/ga/scrape-tcsg-pdf-programs.ts --college north-ga-tech
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

interface PdfConfig {
  collegeSlug: string;
  pdfUrl: string;
  parser: "ngtc" | "cgtc";
  catalogYear: string;
  catalogUrl: string;
}

const COLLEGES: PdfConfig[] = [
  {
    collegeSlug: "north-ga-tech",
    pdfUrl:
      "https://northgatech.edu/wp-content/uploads/2022/01/2025-2026-Programs-of-Study.pdf",
    parser: "ngtc",
    catalogYear: "2025-2026",
    catalogUrl: "https://northgatech.edu/about-us/college-catalog/",
  },
  {
    collegeSlug: "central-ga-tech",
    pdfUrl: "https://www.centralgatech.edu/wp-content/uploads/pdfs/catalog/catalog.pdf",
    parser: "cgtc",
    catalogYear: "2025-2026",
    catalogUrl: "https://www.centralgatech.edu/catalog",
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function downloadPdf(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `tcsg-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function extractText(pdfPath: string): string {
  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  execFileSync("pdftotext", ["-layout", pdfPath, txtPath]);
  return fs.readFileSync(txtPath, "utf-8");
}

function credentialFromText(label: string): ProgramCredential {
  const t = label.toLowerCase();
  if (t.includes("aas") || t.includes("applied science")) return "AAS";
  if (t.includes("associate of arts") || /\baa degree\b/.test(t)) return "AA";
  if (t.includes("associate of science") || /\bas degree\b/.test(t)) return "AS";
  if (t.includes("diploma")) return "diploma";
  if (t.includes("certificate") || t.includes("tcc")) return "certificate";
  if (t.includes("degree")) return "other";
  return "other";
}

const COURSE_RE = /^\s*([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*$/;

function parseCourseLine(
  line: string,
): { prefix: string; number: string; title: string; credits: number | null } | null {
  const m = line.match(COURSE_RE);
  if (!m) return null;
  const title = m[3].replace(/\s+/g, " ").trim();
  // Reject very short or empty titles (often noise)
  if (title.length < 3) return null;
  return {
    prefix: m[1],
    number: m[2],
    title,
    credits: Number(m[4]),
  };
}

// ---------------------------------------------------------------------------
// NGTC parser
// ---------------------------------------------------------------------------

const NGTC_HEADER_RE =
  /^\s*(.+?)\s+(AAS Degree|AS Degree|AA Degree|Diploma|Certificate|TCC)\s*\(([A-Z]{2,4}\d{1,4})\)\s*$/;

function parseNgtc(text: string, catalogUrl: string): ProgramRequirement[] {
  const lines = text.split("\n");
  const programs: ProgramRequirement[] = [];

  // Walk lines, detect header, accumulate until next header or end-marker.
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(NGTC_HEADER_RE);
    if (!m) {
      i++;
      continue;
    }
    const title = m[1].replace(/\s+/g, " ").trim();
    const credentialLabel = m[2];
    const programCode = m[3];
    const credential = credentialFromText(credentialLabel);
    const start = i;
    // Find end: next header, or "Estimated cost of books" line, or 200 lines max
    let end = i + 1;
    while (end < lines.length && end < i + 250) {
      if (NGTC_HEADER_RE.test(lines[end])) break;
      if (/Estimated cost of books/i.test(lines[end])) {
        end++;
        break;
      }
      end++;
    }
    const block = lines.slice(start, end);

    // Total credits
    let totalCredits: number | null = null;
    for (const line of block) {
      const mm = line.match(/Credit Hours Required for Graduation[.\s]+(\d+)/i);
      if (mm) {
        totalCredits = Number(mm[1]);
        break;
      }
    }

    // Description = first paragraph after "Purpose:"
    let description: string | null = null;
    const purposeIdx = block.findIndex((l) => /^\s*Purpose:/i.test(l));
    if (purposeIdx >= 0) {
      const buf: string[] = [];
      const first = block[purposeIdx].replace(/^\s*Purpose:\s*/i, "");
      if (first.trim()) buf.push(first.trim());
      for (let j = purposeIdx + 1; j < block.length; j++) {
        const l = block[j].trim();
        if (!l) break;
        if (/^Admission Requirements:/i.test(l)) break;
        if (/^Program Courses/i.test(l)) break;
        buf.push(l);
      }
      description = buf.join(" ").replace(/\s+/g, " ").trim() || null;
    }

    // Course list: detect section headers like "Basic Skills Courses ... Total N credit hours"
    // and group following course lines under that section. If no section header, fall back
    // to a single "Required Courses" group.
    const groups: RequirementGroup[] = [];
    let currentGroup: RequirementGroup | null = null;

    for (const line of block) {
      const sectionM = line.match(/^\s*([A-Za-z][A-Za-z &/\-]+? Courses)\s+Total\s+(\d+)\s+credit/i);
      if (sectionM) {
        if (currentGroup && currentGroup.courses.length > 0) groups.push(currentGroup);
        currentGroup = {
          name: sectionM[1].trim(),
          credits_required: Number(sectionM[2]),
          choose_n: null,
          courses: [],
        };
        continue;
      }
      const course = parseCourseLine(line);
      if (!course) continue;
      if (!currentGroup) {
        currentGroup = {
          name: "Required Courses",
          credits_required: null,
          choose_n: null,
          courses: [],
        };
      }
      currentGroup.courses.push({ ...course, or_alternatives: [] });
    }
    if (currentGroup && currentGroup.courses.length > 0) groups.push(currentGroup);

    // Only emit if we got at least one course or a total-credits anchor
    if (groups.length > 0 || totalCredits !== null) {
      programs.push({
        title,
        credential,
        program_code: programCode,
        catalog_url: catalogUrl,
        total_credits: totalCredits,
        gpa_minimum: 2.0,
        description,
        requirement_groups: groups,
        matched_program_slug: null,
      });
    }

    i = end;
  }

  return programs;
}

// ---------------------------------------------------------------------------
// CGTC parser
// ---------------------------------------------------------------------------

// Two-line header pattern. Title line ends with "(CODE)"; the immediate next
// non-empty line is the credential label.
const CGTC_HEADER_RE = /^\s{2,}([A-Z][A-Z0-9 &/\-,'.]+?)\s*\(([A-Z0-9]{2,8})\)\s*$/;
const CGTC_CREDENTIAL_LINES = new Set([
  "Diploma",
  "Technical Certificate of Credit",
  "Associate of Applied Science",
  "Associate of Applied Science Degree",
  "Associate of Science Degree",
  "Associate of Arts Degree",
  "Degree",
  "Certificate",
]);

function parseCgtc(text: string, catalogUrl: string): ProgramRequirement[] {
  const lines = text.split("\n");
  const programs: ProgramRequirement[] = [];
  const seen = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(CGTC_HEADER_RE);
    if (!m) {
      i++;
      continue;
    }
    // Skip obvious noise: lines that match the all-caps pattern but are
    // actually section banners (e.g. "ACADEMIC PROGRAMS")
    if (/^(ACADEMIC PROGRAMS|TABLE OF CONTENTS|PROGRAMS OF STUDY)$/i.test(m[1])) {
      i++;
      continue;
    }
    // Find the credential label on the next non-empty line
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) {
      i++;
      continue;
    }
    const credLine = lines[j].trim();
    let credentialLabel = "";
    for (const cred of CGTC_CREDENTIAL_LINES) {
      if (credLine === cred || credLine.startsWith(cred)) {
        credentialLabel = cred;
        break;
      }
    }
    if (!credentialLabel) {
      i++;
      continue;
    }
    const title = m[1]
      .split(" ")
      .map((w) => (w.length > 0 ? w[0] + w.slice(1).toLowerCase() : w))
      .join(" ");
    const programCode = m[2];
    const credential = credentialFromText(credentialLabel);
    const key = `${title}|${programCode}`;
    if (seen.has(key)) {
      i++;
      continue;
    }
    seen.add(key);

    // Block: from i to next header or 300 lines
    let end = j + 1;
    while (end < lines.length && end < i + 300) {
      if (CGTC_HEADER_RE.test(lines[end])) break;
      end++;
    }
    const block = lines.slice(i, end);

    // Total credits
    let totalCredits: number | null = null;
    for (const line of block) {
      const mm = line.match(/(?:Minimum\s+)?Total\s+Hours\s+(\d+)/i);
      if (mm) {
        totalCredits = Number(mm[1]);
        break;
      }
    }

    // Description: paragraph(s) between credential line and "Education Requirements"
    let description: string | null = null;
    {
      const buf: string[] = [];
      let inDesc = false;
      for (let k = 0; k < block.length; k++) {
        const l = block[k].trim();
        if (!inDesc && l === credentialLabel) {
          inDesc = true;
          continue;
        }
        if (!inDesc) continue;
        if (/^Education Requirements/i.test(l)) break;
        if (/^Placement Measure/i.test(l)) break;
        if (l) buf.push(l);
      }
      description = buf.join(" ").replace(/\s+/g, " ").trim() || null;
    }

    // Courses: all matches in block (single group; CGTC doesn't reliably label sections)
    const courses: RequiredCourse[] = [];
    for (const line of block) {
      const course = parseCourseLine(line);
      if (!course) continue;
      courses.push({ ...course, or_alternatives: [] });
    }

    const groups: RequirementGroup[] =
      courses.length > 0
        ? [
            {
              name: "Required Courses",
              credits_required: totalCredits,
              choose_n: null,
              courses,
            },
          ]
        : [];

    if (groups.length > 0 || totalCredits !== null) {
      programs.push({
        title,
        credential,
        program_code: programCode,
        catalog_url: catalogUrl,
        total_credits: totalCredits,
        gpa_minimum: 2.0,
        description,
        requirement_groups: groups,
        matched_program_slug: null,
      });
    }

    i = end;
  }

  return programs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeOne(config: PdfConfig): Promise<CollegePrograms> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Scraping ${config.collegeSlug} (PDF: ${config.pdfUrl})`);
  console.log("=".repeat(60));
  const pdfPath = await downloadPdf(config.pdfUrl);
  console.log(`  Downloaded to ${pdfPath}`);
  const text = extractText(pdfPath);
  console.log(`  Extracted ${text.split("\n").length} lines of text`);

  const programs =
    config.parser === "ngtc"
      ? parseNgtc(text, config.catalogUrl)
      : parseCgtc(text, config.catalogUrl);

  console.log(`  Parsed ${programs.length} programs`);

  return {
    college_slug: config.collegeSlug,
    catalog_year: config.catalogYear,
    catalog_url: config.catalogUrl,
    scraped_at: new Date().toISOString(),
    programs,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0
      ? args[args.indexOf("--college") + 1]
      : null);

  let colleges = COLLEGES;
  if (collegeArg) {
    colleges = COLLEGES.filter((c) => c.collegeSlug === collegeArg);
    if (colleges.length === 0) {
      console.error(
        `Unknown college: ${collegeArg}. Available: ${COLLEGES.map(
          (c) => c.collegeSlug,
        ).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const outDir = path.join(process.cwd(), "data", "ga", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`GA TCSG PDF program scraper — ${colleges.length} college(s)\n`);

  let totalPrograms = 0;
  for (const config of colleges) {
    try {
      const data = await scrapeOne(config);
      if (data.programs.length === 0) {
        console.log(`  No programs found for ${config.collegeSlug}, skipping.`);
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(
        `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
      );
      const outPath = path.join(outDir, `${config.collegeSlug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
      totalPrograms += data.programs.length;
    } catch (e) {
      console.error(`  ERROR scraping ${config.collegeSlug}: ${e}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Done. Total: ${totalPrograms} programs across ${colleges.length} college(s).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
