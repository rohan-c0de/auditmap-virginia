/**
 * scrape-vhcc-pdf-programs.ts — extract program requirements for
 * Virginia Highlands Community College (VCCS) from their PDF-only
 * catalog.
 *
 * Closes #236. VHCC publishes a single combined catalog PDF on
 * https://www.vhcc.edu/catalog rather than an Acalog/CourseLeaf
 * instance.
 *
 * Each program block in the PDF starts with a heading line like:
 *   "Associate of Applied Science (AAS) in Criminal Justice"
 *   "Career Studies Certificate (CSC) in Welding"
 *   "Associate of Science (AS) in Computer Science"
 * Followed by a duration line ("Two/Four semesters"), a description
 * paragraph, and one or more curriculum tables of the form:
 *
 *   Course Number    Course Title                                          Credits
 *   ENG 111          College Composition I                                    3
 *   …
 *   Total Minimum Credits                                                    16
 *
 * Some programs have multiple "Tracks" (Day / Evening / etc.); we
 * collapse these into a single requirement_groups array, one group
 * per track, retaining the per-track Total Minimum Credits.
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/va/scrape-vhcc-pdf-programs.ts
 *   npx tsx scripts/va/scrape-vhcc-pdf-programs.ts --pdf=/tmp/vhcc.pdf --keep-text
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

const COLLEGE_SLUG = "vhcc";
const CATALOG_INDEX_URL = "https://www.vhcc.edu/catalog";
// Known-good fallback (2026-2027). Discovery scrapes the catalog page
// to pick up newer publications automatically.
const FALLBACK_PDF_URL =
  "https://www.vhcc.edu/sites/default/files/2026-03/2026-27%20VHCC%20Catalog%20-%20v1_1%20-%2020260312.pdf";

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
// Discovery + download + pdftotext
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

async function discoverPdfUrl(): Promise<string> {
  try {
    const html = await fetchText(CATALOG_INDEX_URL);
    // VHCC links to PDFs via href="https://www.vhcc.edu/sites/default/files/.../<...>VHCC%20Catalog<...>.pdf"
    const re = /href="(https:\/\/www\.vhcc\.edu\/sites\/default\/files\/[^"]+VHCC[^"]+\.pdf)"/gi;
    const matches: string[] = [];
    let m;
    while ((m = re.exec(html)) !== null) matches.push(m[1]);
    if (matches.length > 0) return matches[0];
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
// Parsing
// ---------------------------------------------------------------------------

const HEADING_RE =
  /^(Associate of Applied Science \(AAS\)|Associate of Arts \(AA\)|Associate of Science \(AS\)|Career Studies Certificate \(CSC\)|Certificate \(CERT\)|Diploma)\s+in\s+(.+?)\s*$/;

function parseCredential(prefix: string): ProgramCredential {
  if (/AAS/.test(prefix)) return "AAS";
  if (/AA\b/.test(prefix)) return "AA";
  if (/AS\b/.test(prefix)) return "AS";
  if (/Diploma/i.test(prefix)) return "diploma";
  return "certificate";
}

interface ProgramHeader {
  startLine: number;
  prefix: string;
  programName: string;
}

function findProgramHeaders(lines: string[]): ProgramHeader[] {
  const out: ProgramHeader[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\s+$/, "");
    const m = trimmed.match(HEADING_RE);
    if (!m) continue;
    out.push({ startLine: i, prefix: m[1], programName: m[2].trim() });
  }
  return out;
}

// Course rows look like:
//   " ENG 111                    College Composition I                              3"
// Sometimes the credit value is a range "3-6", sometimes a single integer.
const COURSE_ROW_RE =
  /^\s+([A-Z]{2,5})\s+(\d{2,4}[A-Z]?)\s+(.+?)\s{2,}(\d+(?:-\d+)?)\s*$/;

const TOTAL_RE =
  /\bTotal\s+(?:Minimum\s+)?Credits(?:\s+Required)?\s*([0-9]+(?:-[0-9]+)?)\s*$/i;

interface ParsedTrack {
  name: string;
  courses: RequiredCourse[];
  totalCredits: number | null;
}

function parseProgramBlock(
  lines: string[],
  startLine: number,
  endLine: number,
): { tracks: ParsedTrack[]; totalCredits: number | null } {
  const tracks: ParsedTrack[] = [];
  let currentTrack: ParsedTrack = {
    name: "Recommended Course Sequence",
    courses: [],
    totalCredits: null,
  };
  const seenInTrack = new Set<string>();
  let blockTotal: number | null = null;

  // Some VHCC programs name their tracks as "Track 1 (Day)" / "Track 2 (Evening)"
  // or split by a "<Foo> Sequence" sub-header. Detect via headings followed by
  // a "Course Number ... Course Title ... Credits" table-header line.
  const TRACK_HEADING_RE = /^(?:\s*)(Track\s+\d+\s*\(.+?\)|.+?Sequence|.+?Schedule)\s*$/i;

  for (let i = startLine + 1; i < endLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // "Total Credits Required" / "Total Minimum Credits"
    const totalMatch = trimmed.match(TOTAL_RE);
    if (totalMatch) {
      const v = totalMatch[1];
      const upper = v.includes("-") ? parseInt(v.split("-")[1], 10) : parseInt(v, 10);
      currentTrack.totalCredits = upper;
      // If this is the first total we see in the block, also use it as
      // the program's overall total. Multiple tracks → keep the largest.
      if (blockTotal === null || upper > blockTotal) blockTotal = upper;
      // Push the current track and prepare a new one (in case another track follows).
      if (currentTrack.courses.length > 0) {
        tracks.push(currentTrack);
      }
      currentTrack = {
        name: "Recommended Course Sequence",
        courses: [],
        totalCredits: null,
      };
      seenInTrack.clear();
      continue;
    }

    // Track heading (e.g. "Track 1 (Day)")
    const trackMatch = trimmed.match(TRACK_HEADING_RE);
    if (
      trackMatch &&
      // Not the column-header row
      !/Course\s+Number\s+Course\s+Title/i.test(trimmed) &&
      // Not the start of a paragraph
      trimmed.length < 60 &&
      /Track\s+\d+/i.test(trimmed)
    ) {
      // If we have queued courses without a total yet, push the partial track
      if (currentTrack.courses.length > 0) tracks.push(currentTrack);
      currentTrack = {
        name: trackMatch[1].trim(),
        courses: [],
        totalCredits: null,
      };
      seenInTrack.clear();
      continue;
    }

    const m = line.match(COURSE_ROW_RE);
    if (!m) continue;
    const [, prefix, number, rawTitle, creditsStr] = m;
    // Skip artifacts: a "row" with Title="Course Title" is the column header
    if (/^Course\s+Title/i.test(rawTitle.trim())) continue;
    const title = rawTitle.replace(/\s+/g, " ").trim();
    const creditsUpper = creditsStr.includes("-")
      ? parseInt(creditsStr.split("-")[1], 10)
      : parseInt(creditsStr, 10);
    const key = `${prefix} ${number}`;
    if (seenInTrack.has(key)) continue;
    seenInTrack.add(key);
    currentTrack.courses.push({
      prefix,
      number,
      title,
      credits: creditsUpper,
      or_alternatives: [],
    });
  }

  // Push the last open track if it has courses
  if (currentTrack.courses.length > 0) tracks.push(currentTrack);

  return { tracks, totalCredits: blockTotal };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tmp = os.tmpdir();
  const pdfPath = ARG_PDF_PATH ?? path.join(tmp, "vhcc-catalog.pdf");
  const txtPath = path.join(tmp, "vhcc-catalog.txt");

  let catalogUrl: string;
  if (ARG_PDF_PATH) {
    catalogUrl = CATALOG_INDEX_URL;
    console.log(`Using local PDF: ${pdfPath}`);
  } else {
    console.log("Discovering latest VHCC catalog PDF...");
    catalogUrl = await discoverPdfUrl();
    console.log(`  PDF URL: ${catalogUrl}`);
    console.log(`  Downloading -> ${pdfPath}`);
    await downloadPdf(catalogUrl, pdfPath);
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
    const { tracks, totalCredits } = parseProgramBlock(lines, h.startLine, nextStart);
    if (tracks.length === 0 || tracks.every((t) => t.courses.length === 0)) continue;

    const requirementGroups: RequirementGroup[] = tracks
      .filter((t) => t.courses.length > 0)
      .map((t) => ({
        name: t.name,
        credits_required: t.totalCredits,
        choose_n: null,
        courses: t.courses,
      }));

    programs.push({
      title: `${h.programName} (${h.prefix.match(/\(([A-Z]+)\)/)?.[1] ?? ""})`.replace(
        /\s\(\)$/,
        "",
      ),
      credential: parseCredential(h.prefix),
      program_code: null,
      catalog_url: catalogUrl,
      total_credits: totalCredits,
      gpa_minimum: 2.0,
      description: null,
      requirement_groups: requirementGroups,
      matched_program_slug: null,
    });
  }

  console.log(`  Parsed ${programs.length} programs`);

  const { matched, unmatched } = applyProgramMatching(programs);
  console.log(
    `  Matcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
  );

  const yearMatch = catalogUrl.match(/(\d{4})-(\d{2,4})/);
  const catalogYear = yearMatch
    ? `${yearMatch[1]}-${yearMatch[2].length === 2 ? `20${yearMatch[2]}` : yearMatch[2]}`
    : "";

  const data: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: catalogYear,
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
