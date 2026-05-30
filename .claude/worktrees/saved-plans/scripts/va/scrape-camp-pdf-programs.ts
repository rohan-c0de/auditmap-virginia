/**
 * scrape-camp-pdf-programs.ts — extract program requirements for
 * Camp Community College (formerly Paul D. Camp / PDCCC) from their
 * Google Drive-hosted PDF catalog.
 *
 * Closes #235. Camp publishes their catalog as PDFs on Google Drive,
 * linked from https://www.pdc.edu/servicesandresources/resources-and-services-for-students/college-catalog-and-student-handbook/.
 *
 * Each program block in the PDF has a clean fielded header:
 *   Program:        Education
 *   Award:          Associate of Arts and Sciences
 *   Plan Code:      624
 *   CIP Code:       24.0101
 *   Length:         60 credit hours
 *   …
 * Then prose, then a "{Program Name} ({Plan Code})" sub-header followed
 * by a "Required Courses and Credits / Sample Schedule" table broken
 * into "First Semester / Second Semester / …" sections, ending with a
 * "Total Program Credits N" or "Total Credits N" row.
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/va/scrape-camp-pdf-programs.ts
 *   npx tsx scripts/va/scrape-camp-pdf-programs.ts --pdf=/tmp/camp.pdf --keep-text
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

const COLLEGE_SLUG = "camp";
const CATALOG_INDEX_URL =
  "https://www.pdc.edu/servicesandresources/resources-and-services-for-students/college-catalog-and-student-handbook/";
// Known-good fallback (2025-2026). Discovery scrapes the catalog page for
// the latest Google Drive file id.
const FALLBACK_DRIVE_ID = "11iMKYCDFeDLd-Xeay1BG5RZIhR-2oiLn";
const FALLBACK_DRIVE_VIEW_URL =
  `https://drive.google.com/file/d/${FALLBACK_DRIVE_ID}/view?usp=sharing`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// CLI
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
// Discovery + download
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

/**
 * Camp's catalog page links to Google Drive PDFs. Discover the file id from
 * the most recent "Camp Catalog & Student Handbook" link. Fall back to the
 * known-good 2025-2026 file id if discovery fails.
 */
async function discoverDriveFileId(): Promise<{ fileId: string; viewUrl: string }> {
  try {
    const html = await fetchText(CATALOG_INDEX_URL);
    // Look for the prominent "Camp Catalog & Student Handbook" link first
    // (it's the current year). If not labelled, fall back to the first
    // drive.google.com/file/d/{id}/view link on the page.
    const re = /href="(https:\/\/drive\.google\.com\/file\/d\/([^/"]+)\/[^"]+)"/g;
    const matches: { url: string; id: string }[] = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      matches.push({ url: m[1], id: m[2] });
    }
    if (matches.length > 0) {
      // The first match is typically the current/featured catalog
      return { fileId: matches[0].id, viewUrl: matches[0].url };
    }
  } catch (e) {
    console.warn(`  discovery failed (${e}); falling back to known URL`);
  }
  return { fileId: FALLBACK_DRIVE_ID, viewUrl: FALLBACK_DRIVE_VIEW_URL };
}

async function downloadDrivePdf(fileId: string, dest: string): Promise<void> {
  // Google Drive direct-download endpoint
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
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
// Parsing
// ---------------------------------------------------------------------------

interface ProgramHeader {
  /** Line index of the "Program:" line */
  startLine: number;
  programName: string;
  awardText: string;
}

function findProgramHeaders(lines: string[]): ProgramHeader[] {
  const out: ProgramHeader[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].trim();
    const b = lines[i + 1].trim();
    const programMatch = a.match(/^Program:\s+(.+?)\s*$/);
    const awardMatch = b.match(/^Award:\s+(.+?)\s*$/);
    if (programMatch && awardMatch) {
      out.push({
        startLine: i,
        programName: programMatch[1].trim(),
        awardText: awardMatch[1].trim(),
      });
    }
  }
  return out;
}

function parseCredential(awardText: string): ProgramCredential {
  const t = awardText.toLowerCase();
  if (/applied science/.test(t)) return "AAS";
  if (/associate of arts and sciences|associate of arts/.test(t)) return "AA";
  if (/associate of science|associate of sciences/.test(t)) return "AS";
  if (/career studies certificate/.test(t)) return "certificate";
  if (/diploma/.test(t)) return "diploma";
  if (/certificate/.test(t)) return "certificate";
  return "other";
}

// Course rows in camp's tables have the form:
//   "        ENG 111            College Composition I1                                  3"
// Multi-column with credits at the end. Some rows have a credit range.
const COURSE_ROW_RE =
  /^\s*([A-Z]{2,5})\s+(\d{2,4}[A-Z]?)(?:\s+or\s+\d{2,4})?\s{2,}(.+?)\s{2,}(\d+(?:-\d+)?)\s*$/;

const TOTAL_RE =
  /\bTotal\s+(?:Program\s+|Credits\s+Required:?\s*|Required:?\s*)?Credits?(?:\s+Required)?\s*([0-9]+(?:-[0-9]+)?)\s*$/i;

function parseProgramBlock(
  lines: string[],
  startLine: number,
  endLine: number,
): { courses: RequiredCourse[]; totalCredits: number | null } {
  const courses: RequiredCourse[] = [];
  const seen = new Set<string>();
  let totalCredits: number | null = null;

  for (let i = startLine + 1; i < endLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const totalMatch = trimmed.match(TOTAL_RE);
    if (totalMatch) {
      const v = totalMatch[1];
      const upper = v.includes("-") ? parseInt(v.split("-")[1], 10) : parseInt(v, 10);
      // Stop at the FIRST "Total Program Credits" row — that's the program total.
      // Per-semester "Total Semester Credits N" rows match the regex too; we
      // need to differentiate. The Program total appears AFTER the last semester
      // total; looking at the actual structure, the program total typically
      // says "Total Program Credits" (or just "Total Credits") and is the last
      // one before the next program block.
      if (/Total\s+Program\s+Credits/i.test(trimmed)) {
        totalCredits = upper;
        // Don't break — there might be additional notes following
      } else if (/Total\s+Semester\s+Credits/i.test(trimmed)) {
        // Per-semester subtotal — ignore
      } else if (/^Total\s+Credits/i.test(trimmed)) {
        // Generic total — only adopt if we haven't seen a more specific one
        if (totalCredits === null) totalCredits = upper;
      }
      continue;
    }

    const m = line.match(COURSE_ROW_RE);
    if (!m) continue;
    const [, prefix, number, rawTitle, creditsStr] = m;
    const title = rawTitle.replace(/\s+/g, " ").replace(/\d+$/, "").trim();
    if (!title) continue;
    if (/^(Course Title|Course Number|Sample|First|Second|Third|Fourth|Fifth)/i.test(title)) {
      continue;
    }
    const upper = creditsStr.includes("-")
      ? parseInt(creditsStr.split("-")[1], 10)
      : parseInt(creditsStr, 10);
    const key = `${prefix} ${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    courses.push({
      prefix,
      number,
      title,
      credits: upper,
      or_alternatives: [],
    });
  }

  return { courses, totalCredits };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tmp = os.tmpdir();
  const pdfPath = ARG_PDF_PATH ?? path.join(tmp, "camp-catalog.pdf");
  const txtPath = path.join(tmp, "camp-catalog.txt");

  let catalogUrl: string;
  if (ARG_PDF_PATH) {
    catalogUrl = CATALOG_INDEX_URL;
    console.log(`Using local PDF: ${pdfPath}`);
  } else {
    console.log("Discovering latest Camp catalog PDF on Google Drive...");
    const { fileId, viewUrl } = await discoverDriveFileId();
    catalogUrl = viewUrl;
    console.log(`  Drive file id: ${fileId}`);
    console.log(`  Downloading -> ${pdfPath}`);
    await downloadDrivePdf(fileId, pdfPath);
  }

  console.log(`Running pdftotext -layout -> ${txtPath}`);
  pdfToText(pdfPath, txtPath);
  const lines = fs.readFileSync(txtPath, "utf8").split(/\r?\n/);
  console.log(`  Loaded ${lines.length} lines of text`);

  const headers = findProgramHeaders(lines);
  console.log(`  Found ${headers.length} program-block headers`);

  const programs: ProgramRequirement[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].startLine : lines.length;
    const { courses, totalCredits } = parseProgramBlock(lines, h.startLine, nextStart);
    if (courses.length === 0) continue;

    programs.push({
      title: h.programName,
      credential: parseCredential(h.awardText),
      program_code: null,
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

  const data: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: "",
    catalog_url: catalogUrl,
    scraped_at: new Date().toISOString(),
    programs,
  };

  const outDir = path.join(process.cwd(), "data", "va", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${COLLEGE_SLUG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\n✓ Wrote ${programs.length} programs to ${outPath}`);

  if (!ARG_KEEP) fs.unlinkSync(txtPath);
  else console.log(`  text kept at ${txtPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
