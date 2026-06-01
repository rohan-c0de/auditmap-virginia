/**
 * scrape-massasoit-programs.ts — MA program scraper for Massasoit CC.
 *
 * Massasoit publishes per-program "Academic Map" PDFs at
 *   https://massasoit.edu/academics/maps/{Program-Name}-25-26.pdf
 * Each program's marketing page on the static HTML site links to its map.
 * The maps render the curriculum as a tabular layout that pdftotext --layout
 * extracts as multi-column text, where the right column carries
 * instructional prose that bleeds onto the same lines as left-column
 * course rows. We split each line at runs of ≥5 spaces to isolate the
 * course-row chunk from the prose.
 *
 * Discovery: walk the 6 academic-pathway index pages, collect program
 * page URLs, scrape the map PDF link from each, parse the PDF.
 *
 * Custom one-off — no other MA college uses this layout.
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-massasoit-programs.ts
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
} from "../../lib/types.js";

const BASE_URL = "https://massasoit.edu";
const COLLEGE_SLUG = "massasoit";
const STATE = "ma";
const CATALOG_YEAR = "2025-2026";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PATHWAYS = [
  "/academics/academic-programs/behavioral-science-public-service-education/",
  "/academics/academic-programs/business-entrepreneurial-leadership/",
  "/academics/academic-programs/health-sciences/",
  "/academics/academic-programs/liberal-studies-and-the-arts/",
  "/academics/academic-programs/science-technology-engineering-math/",
  "/academics/academic-programs/future-work-institute/",
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });
  return res.ok ? res.text() : "";
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function pdfToText(pdfBuf: Buffer): string {
  const tmpPdf = path.join(os.tmpdir(), `massasoit-${process.pid}-${Date.now()}.pdf`);
  const tmpTxt = `${tmpPdf}.txt`;
  fs.writeFileSync(tmpPdf, pdfBuf);
  try {
    execFileSync("pdftotext", ["-layout", tmpPdf, tmpTxt]);
    return fs.readFileSync(tmpTxt, "utf-8");
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpTxt); } catch { /* ignore */ }
  }
}

function classifyCredential(label: string): ProgramCredential {
  const t = label.toLowerCase();
  if (t.includes("associate in applied science") || t.includes("a.a.s")) return "AAS";
  if (t.includes("associate in arts")) return "AA";
  if (t.includes("associate in science")) return "AS";
  if (t.includes("certificate")) return "certificate";
  return "other";
}

// Course-code + title pattern. Applied to the *first* whitespace-split
// chunk of a line so we don't pick up right-column instructional text that
// bleeds into the same line in the PDF's multi-column layout.
const COURSE_HEADER_RE = /^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.+)$/;
const CREDITS_CHUNK_RE = /^(\d+(?:\.\d+)?)[a-zA-Z*+^]?$/;

// Semester section header. The PDF renders these with decorative second
// digits ("Semester 21", "Semester 41") that confuse a digit-anchored
// regex, so we just detect "Semester " and number the groups
// sequentially in the parse loop — semesters in academic maps are
// always presented in order.
const SEMESTER_RE = /^\s*Semester\b/i;

function parseMap(text: string): {
  groups: RequirementGroup[];
  totalCredits: number | null;
} {
  const lines = text.split("\n");
  const groups: RequirementGroup[] = [];
  let currentGroup: RequirementGroup | null = null;
  let semesterNumber = 0;

  for (const raw of lines) {
    const line = raw.replace(/ /g, " ");
    // Stop parsing past the "congratulations / You've Arrived!" footer.
    if (/c\s*o\s*n\s*g\s*r\s*a\s*t\s*u\s*l\s*a\s*t\s*i\s*o\s*n\s*s/i.test(line)) break;

    if (SEMESTER_RE.test(line)) {
      if (currentGroup && currentGroup.courses.length > 0) groups.push(currentGroup);
      semesterNumber += 1;
      currentGroup = {
        name: `Semester ${semesterNumber}`,
        credits_required: null,
        choose_n: null,
        courses: [],
      };
      continue;
    }
    if (!currentGroup) continue;

    // Split at ≥5 consecutive spaces to isolate the left-hand column from
    // right-column prose that pdftotext glued onto the same line.
    const chunks = line.split(/\s{5,}/).map((s) => s.trim()).filter(Boolean);
    if (chunks.length === 0) continue;
    const m = chunks[0].match(COURSE_HEADER_RE);
    if (!m) continue;
    const [, prefix, number, titleRaw] = m;
    const title = titleRaw.replace(/\s+/g, " ").trim();
    if (/^[A-Za-z ]+ Elective$/.test(title)) continue;

    let credits: number | null = null;
    for (let i = 1; i < chunks.length; i++) {
      const cm = chunks[i].match(CREDITS_CHUNK_RE);
      if (cm) {
        credits = Number(cm[1]);
        break;
      }
    }
    currentGroup.courses.push({
      prefix,
      number,
      title,
      credits,
      or_alternatives: [],
    });
  }
  if (currentGroup && currentGroup.courses.length > 0) groups.push(currentGroup);

  // Total credits: prefer the prose statement ("A minimum of 63 credits …");
  // fall back to summing course-level credits.
  let total: number | null = null;
  const totalProse = text.match(/minimum of\s+(\d{2,3})\s+credits/i);
  if (totalProse) total = Number(totalProse[1]);
  if (total === null && groups.length > 0) {
    const sum = groups.reduce(
      (s, g) => s + g.courses.reduce((cs, c) => cs + (c.credits ?? 0), 0),
      0,
    );
    if (sum > 0) total = sum;
  }

  return { groups, totalCredits: total };
}

async function discoverProgramPages(): Promise<string[]> {
  const seen = new Set<string>();
  const programs = new Set<string>();
  for (const pathway of PATHWAYS) {
    const html = await fetchText(`${BASE_URL}${pathway}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const clean = href.split("#")[0].split("?")[0];
      if (!clean.startsWith(pathway)) return;
      if (clean === pathway) return;
      if (clean.includes("/departments/")) return;
      if (clean.endsWith("/index.html")) return;
      if (!clean.endsWith(".html")) return;
      if (seen.has(clean)) return;
      seen.add(clean);
      programs.add(clean);
    });
  }
  return [...programs].sort();
}

async function scrapeProgram(
  programPath: string,
): Promise<ProgramRequirement | null> {
  const html = await fetchText(`${BASE_URL}${programPath}`);
  if (!html) return null;
  const $ = cheerio.load(html);
  const title = $("h1").first().text().replace(/\s+/g, " ").trim();
  if (!title) return null;
  const cleanTitle = title.replace(/\s+Program$/i, "");

  const credentialLabel = $("h2").first().text().replace(/\s+/g, " ").trim();
  let credential = classifyCredential(credentialLabel);

  const mapLink = $("a[href*='/academics/maps/']")
    .filter((_, a) => ($(a).attr("href") ?? "").endsWith(".pdf"))
    .first();
  if (mapLink.length === 0) return null;
  const mapHref = mapLink.attr("href")!;
  const mapUrl = mapHref.startsWith("http") ? mapHref : `${BASE_URL}${mapHref}`;

  const pdfBuf = await fetchBuffer(mapUrl);
  if (!pdfBuf) return null;
  const pdfText = pdfToText(pdfBuf);

  if (credential === "other") {
    const headerLine = pdfText.split("\n").slice(0, 10).join(" ");
    credential = classifyCredential(headerLine);
  }

  const { groups, totalCredits } = parseMap(pdfText);
  if (groups.length === 0) return null;

  return {
    title: cleanTitle,
    credential,
    program_code: null,
    catalog_url: `${BASE_URL}${programPath}`,
    total_credits: totalCredits,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

async function main() {
  const programs: ProgramRequirement[] = [];
  const programPaths = await discoverProgramPages();
  console.log(`Discovered ${programPaths.length} program page(s)`);

  let parsed = 0;
  let skipped = 0;
  for (const p of programPaths) {
    try {
      const program = await scrapeProgram(p);
      if (program) {
        programs.push(program);
        parsed++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.warn(`  ! ${p}: ${e instanceof Error ? e.message : e}`);
      skipped++;
    }
    await sleep(80);
  }
  console.log(`Parsed ${parsed} programs; skipped ${skipped}`);

  const { matched, unmatched } = applyProgramMatching(programs);
  console.log(`Matcher: ${matched} matched, ${unmatched} unmatched`);

  const out: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: CATALOG_YEAR,
    catalog_url: `${BASE_URL}/academics/academic-programs/`,
    scraped_at: new Date().toISOString(),
    programs,
  };

  const outDir = path.join(process.cwd(), "data", STATE, "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${COLLEGE_SLUG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✓ Wrote ${programs.length} programs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
