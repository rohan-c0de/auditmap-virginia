/**
 * scrape-programs.ts — degree/program requirements for DC (UDC Community
 * College, slug `udc-cc`).
 *
 * UDC-CC has no Acalog/CourseLeaf/Coursedog catalog (udc.smartcatalogiq.com
 * is an empty Sitecore shell, catalog.udc.edu doesn't resolve). Programs are
 * listed as an accordion on https://www.udc.edu/cc/ with one page per
 * program, and each page links a per-program curriculum PDF on
 * docs.udc.edu/academics/ (e.g. AS-Business-Administration.pdf). The PDFs
 * are clean column-layout tables:
 *
 *   FIRST SEMESTER
 *     Course #   Course Title                Credits  Semester  Grade  Prerequisites
 *     FSEM-101C  First Year Seminar            1
 *     ...
 *                       Total Credit Hours:   16
 *
 * A "Developmental Education Courses" table precedes the curriculum on
 * some PDFs; its credits "do not count towards degree completion" (their
 * words), so it is skipped.
 *
 * PDF quirks handled:
 *   - prefix typos vs the SIS (BMGT-104C in the PDF, BGMT 104C in Banner) —
 *     corrected against the prefix vocabulary built from data/dc/courses/
 *   - wrapped rows where the credits cell lands on a continuation line —
 *     credits become null rather than garbage
 *   - prerequisite-column course codes — only the line-leading code is taken
 *
 * Requires: pdftotext (poppler) on PATH. brew install poppler /
 * apt-get install poppler-utils. (Same requirement as
 * scripts/va/scrape-vhcc-pdf-programs.ts.)
 *
 * Usage:
 *   npx tsx scripts/dc/scrape-programs.ts
 *   npx tsx scripts/dc/scrape-programs.ts --keep-text   # keep /tmp text dumps
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import * as cheerio from "cheerio";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequirementGroup,
} from "../../lib/types";

const BASE = "https://www.udc.edu/cc/";
const COLLEGE_SLUG = "udc-cc";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const KEEP_TEXT = process.argv.includes("--keep-text");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

// ---------------------------------------------------------------------------
// Prefix vocabulary — corrects PDF typos (BMGT → BGMT) against the SIS
// ---------------------------------------------------------------------------

function loadPrefixVocab(): Set<string> {
  const vocab = new Set<string>();
  const coursesDir = path.join(process.cwd(), "data", "dc", "courses", COLLEGE_SLUG);
  if (!fs.existsSync(coursesDir)) return vocab;
  for (const f of fs.readdirSync(coursesDir).filter((f) => f.endsWith(".json"))) {
    try {
      const sections = JSON.parse(fs.readFileSync(path.join(coursesDir, f), "utf-8"));
      if (!Array.isArray(sections)) continue;
      for (const s of sections) {
        if (typeof s?.course_prefix === "string") vocab.add(s.course_prefix);
      }
    } catch {
      /* skip unreadable term file */
    }
  }
  return vocab;
}

/**
 * If `prefix` isn't in the SIS vocabulary but a single adjacent-letter
 * transposition of it is, return the corrected prefix. Conservative: only
 * one transposition, only when the result is unambiguous.
 */
function correctPrefix(prefix: string, vocab: Set<string>): string {
  if (vocab.size === 0 || vocab.has(prefix)) return prefix;
  const candidates = new Set<string>();
  for (let i = 0; i < prefix.length - 1; i++) {
    const swapped =
      prefix.slice(0, i) + prefix[i + 1] + prefix[i] + prefix.slice(i + 2);
    if (vocab.has(swapped)) candidates.add(swapped);
  }
  return candidates.size === 1 ? [...candidates][0] : prefix;
}

// ---------------------------------------------------------------------------
// Program discovery from the /cc/ accordion
// ---------------------------------------------------------------------------

interface DiscoveredProgram {
  pageUrl: string;
  pdfUrl: string;
}

async function discoverProgramPdfs(): Promise<DiscoveredProgram[]> {
  console.log(`Fetching program index ${BASE} ...`);
  const html = await fetchText(BASE);
  const $ = cheerio.load(html);
  const pageUrls = new Set<string>();
  $("a[href*='programs-majors']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || href.includes("#")) return;
    const abs = new URL(href, BASE).href;
    pageUrls.add(abs);
  });
  console.log(`  ${pageUrls.size} program pages found`);

  const out: DiscoveredProgram[] = [];
  const seenPdfs = new Set<string>();
  for (const pageUrl of [...pageUrls].sort()) {
    await sleep(400);
    let pageHtml: string;
    try {
      pageHtml = await fetchText(pageUrl);
    } catch (e) {
      console.error(`  ✗ ${pageUrl}: ${(e as Error).message}`);
      continue;
    }
    const $$ = cheerio.load(pageHtml);
    // Curriculum PDFs live under docs.udc.edu/{academics,cc,pos}/ with
    // filenames like AS-Business-Administration.pdf,
    // Computer-Science-AS-Program-of-Study-*.pdf, aasn-program-of-study.pdf.
    // Pages also link handbooks / outcome-data / flyers — exclude those.
    $$("a[href*='docs.udc.edu']").each((_, el) => {
      const href = $$(el).attr("href") || "";
      if (!/\.pdf$/i.test(href.split("?")[0])) return;
      const name = decodeURIComponent(href.split("/").pop() || "");
      if (/handbook|^data-|flyer|brochure|application|checklist|faq/i.test(name)) return;
      if (!/program.?of.?study|\bpos\b|^A\.?A\.?S?|^AS-|^AA-|certificate|curriculum|\/pos\//i.test(`${name} ${href}`)) return;
      const abs = new URL(href, pageUrl).href;
      if (seenPdfs.has(abs)) return;
      seenPdfs.add(abs);
      out.push({ pageUrl, pdfUrl: abs });
    });
  }
  console.log(`  ${out.length} curriculum PDFs discovered`);
  return out;
}

// ---------------------------------------------------------------------------
// PDF parsing
// ---------------------------------------------------------------------------

function humanize(primary: string, fallbackSlug: string): string {
  const clean = (s: string) =>
    s
      .replace(/program.?of.?study|\bpos\b|curriculum|revised|layout/gi, " ")
      .replace(/[0-9._%-]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const fromFile = clean(primary);
  return fromFile.length >= 4 ? fromFile : clean(fallbackSlug.replace(/-/g, " "));
}

function credentialFromTitle(title: string, pdfUrl: string): ProgramCredential {
  const t = `${title} ${path.basename(pdfUrl)}`;
  if (/associate.{0,8}applied\s+science|\bA\.?A\.?S\b/i.test(t)) return "AAS";
  if (/associate.{0,8}science|\bA\.?S\b\.?/i.test(t)) return "AS";
  if (/associate.{0,8}arts|\bA\.?A\b\.?/i.test(t)) return "AA";
  if (/certificate/i.test(t)) return "certificate";
  return "other";
}

// Optional "1st Semester" lead handles the nursing-POS layout where the
// semester label shares the line with the first course of the block.
// Prefix/number separator is hyphen OR whitespace runs — the PHIT layout
// puts "FSEM            101C" in two wide columns.
const COURSE_ROW =
  /^\s*(?:\d(?:st|nd|rd|th)\s+Semester\s+)?([A-Z]{2,5})(?:-|\s+)([0-9]{2,3}[A-Z]?)\b\s+(.+?)(?:\s{2,}(\d{1,2})(?:\s|$))?\s*$/;
// Three heading shapes: "FIRST SEMESTER" sequence tables, standalone
// ordinals ("1st Semester"), and ALL-CAPS requirement blocks ("GENERAL
// EDUCATION REQUIREMENTS", "FIRST-YEAR 100 LEVEL NURSING COURSES") whose
// line may carry trailing column headers.
const GROUP_HEADING = /^\s*((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SUMMER|FALL|SPRING)\s+(?:SEMESTER|SESSION|YEAR)[A-Z\s\-()]*)\s*$/i;
const GROUP_HEADING_ORDINAL = /^\s*(\d(?:st|nd|rd|th)\s+Semester)\s*$/i;
const GROUP_HEADING_CAPS = /^\s*([A-Z][A-Z0-9\s\-&/]{8,}?(?:REQUIREMENTS|COURSES))(?:\s{2,}.*)?\s*$/;
const GROUP_TOTAL = /Total\s+Credit\s+Hours:?\s+(\d{1,3})/i;
const GROUP_TOTAL_SUFFIX = /^\s*Total\s+.{3,60}?\s+(\d{1,3})\s+Credit\s+Hours\s*$/i;
const GROUP_TOTAL_PLAIN = /^\s*Total\s+Credits\s+(\d{1,3})\s*$/i;
const PROGRAM_TOTAL = /Total\s+Credit\s+Hours?\s+for\s+.*?:\s*(\d{1,3})/i;
const PROGRAM_TOTAL_CAPS = /^\s*TOTAL\s+SEMESTER\s+HOURS\s+(\d{1,3})\s*$/im;
const DEVELOPMENTAL = /Developmental\s+Education\s+Courses/i;

function parsePdf(
  pdfUrl: string,
  pageUrl: string,
  vocab: Set<string>,
): ProgramRequirement | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "udc-pdf-"));
  const pdfPath = path.join(tmp, "program.pdf");
  const txtPath = path.join(tmp, "program.txt");
  try {
    execFileSync("curl", ["-s", "-L", "--max-time", "30", "-A", UA, "-o", pdfPath, pdfUrl]);
    execFileSync("pdftotext", ["-layout", pdfPath, txtPath]);
  } catch (e) {
    console.error(`  ✗ download/pdftotext failed for ${pdfUrl}: ${(e as Error).message}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  const text = fs.readFileSync(txtPath, "utf-8");
  if (KEEP_TEXT) {
    fs.copyFileSync(txtPath, `/tmp/udc-${path.basename(pdfUrl, ".pdf")}.txt`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const lines = text.split("\n");

  // Title: first line mentioning a credential; else a humanized filename
  // ("2025.26-mortuary-science-pos" → "Mortuary Science"), never the
  // university letterhead line.
  const credentialLine = lines.find(
    (l) => /associate|certificate|diploma/i.test(l) && l.trim().length > 10,
  );
  const title = credentialLine
    ? credentialLine.trim().replace(/\s{2,}/g, " ")
    : humanize(
        decodeURIComponent(path.basename(pdfUrl, ".pdf")),
        // Cryptic filenames (PN-Program-of-Study → "PN") fall back to the
        // program page's URL slug, which is always descriptive.
        pageUrl.replace(/\/index$/, "").split("/").filter(Boolean).pop() || "",
      );

  const groups: RequirementGroup[] = [];
  let current: RequirementGroup | null = null;
  let inDevelopmental = false;
  let totalCredits: number | null = null;

  for (const line of lines) {
    if (DEVELOPMENTAL.test(line)) {
      inDevelopmental = true;
      continue;
    }
    const heading =
      line.match(GROUP_HEADING) ||
      line.match(GROUP_HEADING_ORDINAL) ||
      line.match(GROUP_HEADING_CAPS);
    if (heading && !/^\s*TOTAL\b/i.test(line)) {
      inDevelopmental = false;
      if (current && current.courses.length > 0) groups.push(current);
      current = {
        name: heading[1].trim().replace(/\s{2,}/g, " "),
        credits_required: null,
        choose_n: null,
        courses: [],
      };
      continue;
    }
    const programTotal = line.match(PROGRAM_TOTAL) || line.match(PROGRAM_TOTAL_CAPS);
    if (programTotal) {
      totalCredits = parseInt(programTotal[1], 10);
      continue;
    }
    const groupTotal =
      line.match(GROUP_TOTAL) ||
      line.match(GROUP_TOTAL_SUFFIX) ||
      line.match(GROUP_TOTAL_PLAIN);
    if (groupTotal && current) {
      current.credits_required = parseInt(groupTotal[1], 10);
      groups.push(current);
      current = null;
      continue;
    }
    if (inDevelopmental) continue;
    if (/^\s*Course\s*#/i.test(line)) {
      // Some PDFs start a table without a semester heading — open an
      // implicit group so their rows aren't dropped.
      if (!current) {
        current = { name: "Curriculum", credits_required: null, choose_n: null, courses: [] };
      }
      continue;
    }
    if (!current) continue;
    const row = line.match(COURSE_ROW);
    if (!row) continue;
    const [, rawPrefix, number, rawTitle, credits] = row;
    const prefix = correctPrefix(rawPrefix, vocab);
    // The title cell can swallow the prerequisites column on wrapped rows —
    // cut it at 2+ consecutive spaces if any survived the regex.
    const courseTitle = rawTitle.split(/\s{2,}/)[0].trim();
    current.courses.push({
      prefix,
      number,
      title: courseTitle,
      credits: credits ? parseInt(credits, 10) : null,
      or_alternatives: [],
    });
  }
  if (current && current.courses.length > 0) groups.push(current);

  if (groups.length === 0) {
    console.log(`  – no curriculum tables in ${path.basename(pdfUrl)} (skipped)`);
    return null;
  }

  return {
    title,
    credential: credentialFromTitle(title, pdfUrl),
    program_code: null,
    catalog_url: pageUrl,
    total_credits: totalCredits,
    gpa_minimum: null,
    description: null,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("UDC-CC program scraper (PDF curricula)\n");
  const vocab = loadPrefixVocab();
  console.log(`Prefix vocabulary: ${vocab.size} prefixes from data/dc/courses/${COLLEGE_SLUG}/`);

  const discovered = await discoverProgramPdfs();
  if (discovered.length === 0) {
    console.error("No curriculum PDFs discovered — leaving existing data untouched.");
    process.exit(1);
  }

  const programs: ProgramRequirement[] = [];
  const seenTitles = new Set<string>();
  for (const d of discovered) {
    await sleep(400);
    console.log(`Parsing ${path.basename(d.pdfUrl)} ...`);
    const program = parsePdf(d.pdfUrl, d.pageUrl, vocab);
    if (program) {
      // Concentration variants share a credential line (the three Music
      // PDFs) — qualify duplicates from the filename so titles stay unique.
      if (seenTitles.has(program.title)) {
        const qualifier = decodeURIComponent(path.basename(d.pdfUrl, ".pdf"))
          .replace(/[0-9._%-]+/g, " ")
          .replace(/program of study|pos|curriculum|revised|layout/gi, " ")
          .trim()
          .split(/\s+/)
          .slice(-1)[0];
        if (qualifier) program.title = `${program.title} — ${qualifier}`;
      }
      seenTitles.add(program.title);
      const courseCount = program.requirement_groups.reduce(
        (n, g) => n + g.courses.length,
        0,
      );
      console.log(
        `  ✓ "${program.title}" (${program.credential}) — ${program.requirement_groups.length} groups, ${courseCount} courses, total ${program.total_credits ?? "?"} cr`,
      );
      programs.push(program);
    }
  }

  if (programs.length === 0) {
    console.error("Parsed 0 programs — leaving existing data untouched.");
    process.exit(1);
  }

  const { matched, unmatched } = applyProgramMatching(programs);
  console.log(`\nMatcher: ${matched} matched / ${unmatched} unmatched`);

  const data: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: "",
    catalog_url: BASE,
    scraped_at: new Date().toISOString(),
    programs,
  };

  const outDir = path.join(process.cwd(), "data", "dc", "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${COLLEGE_SLUG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`✓ Wrote ${programs.length} programs → ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
