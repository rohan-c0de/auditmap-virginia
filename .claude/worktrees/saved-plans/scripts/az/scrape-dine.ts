/**
 * scrape-dine.ts — Diné College course schedule (Navajo Nation tribal college)
 *
 * Diné's my.dinecollege.edu portal is SSO-gated via QuickLaunch (no public
 * guest endpoint), so the only public source is the per-semester schedule
 * PDFs at https://www.dinecollege.edu/admissions/course-schedule/. The
 * PDFs are produced by "Microsoft: Print To PDF" from what looks like an
 * Excel report, but `pdftotext -layout` recovers the column structure
 * cleanly enough to scrape.
 *
 * Strategy:
 *   1. Discover current-term PDFs from the schedule page (file names
 *      include the semester, e.g. Fall-26-Course-Schedule-May-20-2026.pdf).
 *   2. Download each PDF and convert via `pdftotext -layout`.
 *   3. Walk the line stream tracking: current page boundaries, current
 *      "School of …" header, current "<Discipline> Courses" subsection.
 *   4. For each course row that starts with `<PREFIX> <NUMBER> <SECTION>`,
 *      extract columns by regex (column positions aren't reliable across
 *      pages — pdftotext layout drifts).
 *
 * Requires `pdftotext` on PATH (poppler-utils). macOS: `brew install
 * poppler`. Linux CI: `sudo apt-get install -y poppler-utils`.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-dine.ts
 *   npx tsx scripts/az/scrape-dine.ts --no-import
 *   npx tsx scripts/az/scrape-dine.ts --pdf /tmp/Fall-26-Course-Schedule-May-20-2026.pdf --term 2026FA
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import * as cheerio from "cheerio";

const SCHEDULE_PAGE_URL =
  "https://www.dinecollege.edu/admissions/course-schedule/";
const COLLEGE_SLUG = "dine-college";
const CAMPUS = "Tsaile Main Campus";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// Map PDF filename patterns to standardized term codes.
function classifyPdfTerm(filename: string): string | null {
  const base = filename.toLowerCase();
  // Patterns we've seen in Diné PDF names:
  //   Fall-26-Course-Schedule-May-20-2026.pdf       → Fall 2026
  //   Summer-26-Course-Schedule-May-20-2026.pdf     → Summer 2026
  //   SP2026_2nd-8wk-Course-Schedule_03162026.pdf   → Spring 2026
  //   SPR-25-Course-Schedule-Nov-22-2024_SDSE.pdf   → Spring 2025
  // Order matters: try the most specific patterns first so e.g. "fall-26"
  // doesn't get cut off by a more permissive "fall" match.
  const candidates: Array<[RegExp, "sm-y4" | "sm-y2" | "y4-sm" | "abbr-y4" | "abbr-y2"]> = [
    [/(spring|summer|fall|winter)[-_\s]*(\d{2})(?:\D|$)/, "sm-y2"],
    [/(spring|summer|fall|winter)[-_\s]*(20\d{2})/, "sm-y4"],
    [/(20\d{2})[-_\s]*(spring|summer|fall|winter)/, "y4-sm"],
    [/(?:^|[^a-z])(sp|spr|su|sum|fa|fall|wi|win)(20\d{2})/, "abbr-y4"],
    [/(?:^|[^a-z])(sp|spr|su|sum|fa|fall|wi|win)[-_]?(\d{2})(?:\D|$)/, "abbr-y2"],
  ];
  const seasonMap: Record<string, string> = {
    spring: "SP", sp: "SP", spr: "SP",
    summer: "SU", su: "SU", sum: "SU",
    fall: "FA", fa: "FA",
    winter: "WI", wi: "WI", win: "WI",
  };
  for (const [re, shape] of candidates) {
    const m = base.match(re);
    if (!m) continue;
    let season: string;
    let yearRaw: string;
    if (shape === "y4-sm") {
      yearRaw = m[1];
      season = m[2];
    } else {
      season = m[1];
      yearRaw = m[2];
    }
    const seasonCode = seasonMap[season];
    if (!seasonCode) continue;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}${seasonCode}`;
  }
  return null;
}

async function fetchSchedulePagePdfs(): Promise<{ url: string; term: string }[]> {
  const res = await fetch(SCHEDULE_PAGE_URL, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${SCHEDULE_PAGE_URL}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const seenUrls = new Set<string>();
  const out: { url: string; term: string }[] = [];
  const currentYear = new Date().getFullYear();

  $('a[href$=".pdf"]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (seenUrls.has(href)) return;
    seenUrls.add(href);
    // Pick out only course-schedule PDFs (not catalog or rubric documents)
    if (!/course[-_\s]*schedule|class[-_\s]*schedule|course[-_\s]*list/i.test(href))
      return;
    const filename = href.split("/").pop() || "";
    const term = classifyPdfTerm(filename);
    if (!term) return;
    // Only ship terms from current year or later
    const year = parseInt(term.substring(0, 4), 10);
    if (year < currentYear) return;
    out.push({ url: href, term });
  });

  return out;
}

async function downloadPdf(url: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dine-pdf-"));
  const outPath = path.join(tmpDir, "schedule.pdf");
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return outPath;
}

function pdfToText(pdfPath: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `pdftotext failed (install poppler-utils — \`brew install poppler\` on macOS, ` +
        `\`apt-get install -y poppler-utils\` on Debian/Ubuntu): ${e}`,
    );
  }
}

// Regex for a course row's leading tokens.
//   ARH 211 11    Survey of Nat American Art       3    Karla M Britton  ...
const COURSE_ROW = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(\d{1,4}[A-Z]?)\s+(.+)$/;

interface ParsedRow {
  prefix: string;
  number: string;
  section: string;
  /** Raw remainder of the line after `<prefix> <number> <section>`. */
  rest: string;
}

function tryParseCourseRow(line: string): ParsedRow | null {
  const m = line.match(COURSE_ROW);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3], rest: m[4] };
}

// Time tokens that appear in the row, e.g. "3:00 pm" or "11:50 am"
const TIME_RE = /\b(\d{1,2}:\d{2})\s*(am|pm)\b/gi;

// Days tokens. Diné uses M, T, W, R (Thursday), F. We accept the
// concatenated form (e.g. "MW", "MWF", "TR") and the spaced form.
function normalizeDineDays(raw: string): string {
  const cleaned = raw.replace(/[^MTWRFSU]/gi, "").toUpperCase();
  const out: string[] = [];
  const map: Record<string, string> = { M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa", U: "Su" };
  for (const c of cleaned) {
    const m = map[c];
    if (m && !out.includes(m)) out.push(m);
  }
  return out.join(" ");
}

function determineMode(rest: string, comment: string): CourseSection["mode"] {
  const all = `${rest} ${comment}`.toLowerCase();
  if (/online via zoom|zoom/.test(all)) return "zoom";
  if (/hybrid|hyflex/.test(all)) return "hybrid";
  if (/\bonline\b|w\/canvas|asynchronous|distance/.test(all)) return "online";
  return "in-person";
}

// Parse the trailing portion of a course row to extract structured fields.
// The "rest" is the line *after* the leading `<prefix> <number> <section>`.
// Diné PDFs use whitespace alignment that pdftotext mostly preserves.
function parseRest(
  rest: string,
  commentLine: string,
): {
  title: string;
  credits: number;
  instructor: string | null;
  startTime: string;
  endTime: string;
  days: string;
  location: string;
  seatsOpen: number | null;
  seatsTotal: number | null;
  prereqs: string[];
  prereqText: string | null;
  mode: CourseSection["mode"];
} {
  const mode = determineMode(rest, commentLine);

  // Extract times first — used as anchors. There should be either 0
  // (online with no scheduled meeting) or 2 (in-person/hybrid).
  const times: string[] = [];
  let tm;
  TIME_RE.lastIndex = 0;
  while ((tm = TIME_RE.exec(rest)) !== null) {
    times.push(`${tm[1]} ${tm[2].toLowerCase()}`);
  }
  const startTime = times[0] || "";
  const endTime = times[1] || "";

  // Find "Online" anchor for online sections (used to detect no-meeting case)
  const onlineMatch = rest.match(/\bOnline\b/i);

  // Trailing tail starting from the end: prerequisites (course codes
  // separated by ", " or just space at the very end), then max-reg,
  // then current-reg, then room, then bldg, then dates (if shown).
  // Easier: tokenize from the end.
  // Course code regex for prereqs (no space variant): "ENG101", "ACC200"
  // We harvest all trailing course-code-like tokens.
  // FULL(N) means class is at capacity.
  const tail = rest.replace(/\s+/g, " ").trim();

  // Pull prereq tokens off the right edge: one or more course codes
  // separated by spaces or commas/`and`.
  const prereqMatch = tail.match(/\s+((?:[A-Z]{2,5}\d{3}[A-Z]?(?:\s*[,&]\s*|\s+and\s+|\s+)?)+)$/);
  const prereqs: string[] = [];
  let prereqText: string | null = null;
  if (prereqMatch) {
    prereqText = prereqMatch[1].trim();
    const codes = prereqText.match(/[A-Z]{2,5}\d{3}[A-Z]?/g) || [];
    prereqs.push(...new Set(codes));
  }

  // Detect seats. Patterns: "  8    18    ENG101" or "FULL(18)    18"
  // We look for an integer followed by an integer near the end (before prereqs).
  const cleanedForSeats = prereqText
    ? tail.slice(0, tail.length - prereqText.length).trim()
    : tail;
  let seatsOpen: number | null = null;
  let seatsTotal: number | null = null;
  const fullMatch = cleanedForSeats.match(/FULL\((\d+)\)\s+(\d+)\s*$/i);
  if (fullMatch) {
    seatsOpen = 0;
    seatsTotal = parseInt(fullMatch[2], 10);
  } else {
    const numTail = cleanedForSeats.match(/\b(\d{1,3})\s+(\d{1,3})\s*$/);
    if (numTail) {
      // Heuristic: if right is >= left, treat right=max, left=open.
      const a = parseInt(numTail[1], 10);
      const b = parseInt(numTail[2], 10);
      if (b >= a && b <= 200) {
        seatsOpen = a;
        seatsTotal = b;
      }
    }
  }

  // Credits: appears right after title, before instructor. Find the first
  // standalone small integer (1-9) in the line — that's credits. Avoid
  // confusing it with times by searching only before the first time token.
  const beforeTime = startTime ? tail.slice(0, tail.indexOf(times[0].split(" ")[0])) : tail;
  const beforeTimeNoOnline = onlineMatch
    ? tail.slice(0, onlineMatch.index)
    : beforeTime;
  const credMatch = beforeTimeNoOnline.match(/\s+(\d)\s+/);
  let credits = 0;
  let titleAndInstructor = beforeTimeNoOnline;
  if (credMatch && credMatch.index !== undefined) {
    credits = parseInt(credMatch[1], 10);
    titleAndInstructor = beforeTimeNoOnline.slice(0, credMatch.index).trim();
  }

  // Title is everything up to the credits marker; the instructor name
  // comes after credits and before the time. Heuristic: take everything
  // after credits, before the first time anchor, as instructor.
  const title = titleAndInstructor.trim();
  let instructor: string | null = null;
  if (credMatch && credMatch.index !== undefined) {
    const afterCred = beforeTimeNoOnline.slice(credMatch.index + credMatch[0].length).trim();
    if (afterCred && !/^(arr|tba|tbd|staff)$/i.test(afterCred)) {
      instructor = afterCred;
    }
  }

  // Days: between endTime and the location/seats block.
  let days = "";
  if (times.length >= 2) {
    const afterEnd = tail.slice(tail.indexOf(times[1].split(" ")[0]) + times[1].length);
    const dayMatch = afterEnd.match(/\s+([MTWRFSU]+)\s+/);
    if (dayMatch) days = normalizeDineDays(dayMatch[1]);
  }

  // Location: bldg + room. Format: "    GCB    111    "
  let location = "";
  if (times.length >= 2) {
    const tailFromDays = tail.slice(tail.indexOf(times[1].split(" ")[0]));
    // Match "<BLDG_CODE> <ROOM>" near the seats section.
    const locMatch = tailFromDays.match(/\s+([A-Z]{2,6})\s+(\d{1,4}[A-Z]?)\s+/);
    if (locMatch) location = `${locMatch[1]} ${locMatch[2]}`;
  }

  return {
    title,
    credits,
    instructor: instructor && !/^DC Staff$/i.test(instructor) ? instructor : null,
    startTime,
    endTime,
    days,
    location,
    seatsOpen,
    seatsTotal,
    prereqs,
    prereqText,
    mode,
  };
}

interface ParseContext {
  termCode: string;
  termName: string;
  termStartDate: string;
}

function parsePdfText(text: string, ctx: ParseContext): CourseSection[] {
  const sections: CourseSection[] = [];
  const lines = text.split("\n");

  let currentSchool = "";
  let currentSubject = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const trimmed = line.trim();

    // Page break markers — skip
    if (/^Page \d+ of \d+/.test(trimmed)) continue;
    if (/^Diné College Course Schedule/.test(trimmed)) continue;
    if (/^Printed:/.test(trimmed)) continue;
    if (/^Course Sec Title/.test(trimmed)) continue;
    if (/^Comments\b/.test(trimmed)) continue;
    if (/^For questions about enrolling/.test(trimmed)) continue;
    if (/^\d+ of \d+\s+For questions/.test(trimmed)) continue;
    if (/^\d+ of \d+\s*$/.test(trimmed)) continue;
    if (!trimmed) continue;

    // School header — left-justified "School of ..." or "Center of ..."
    if (/^(School of|Center for|Center of) /.test(trimmed) && !/Courses$/.test(trimmed)) {
      currentSchool = trimmed;
      continue;
    }

    // Subject header — indented "<Discipline> Courses"
    if (/^\s+[A-Z][\w &/-]+ Courses\s*$/.test(line)) {
      currentSubject = trimmed.replace(/\s+Courses$/, "");
      continue;
    }

    // Course row
    const parsed = tryParseCourseRow(line);
    if (!parsed) continue;

    // Look ahead 1-2 lines for the comment ("In person course" / "Online w/CANVAS" / etc.)
    let commentLine = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (/^(In person course|Online (w\/CANVAS|via Zoom|w\/Zoom)|Hybrid|Asynchronous)/i.test(l)) {
        commentLine = l;
        break;
      }
      // Stop scanning if we hit the next course row
      if (tryParseCourseRow(lines[j])) break;
    }

    const fields = parseRest(parsed.rest, commentLine);

    if (!fields.title) continue;

    sections.push({
      college_code: COLLEGE_SLUG,
      term: ctx.termCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: fields.title,
      credits: fields.credits,
      crn: `${parsed.prefix}${parsed.number}-${parsed.section}`,
      days: fields.days,
      start_time: fields.startTime,
      end_time: fields.endTime,
      start_date: ctx.termStartDate,
      location: fields.location,
      campus: CAMPUS,
      mode: fields.mode,
      instructor: fields.instructor,
      seats_open: fields.seatsOpen,
      seats_total: fields.seatsTotal,
      prerequisite_text: fields.prereqText,
      prerequisite_courses: fields.prereqs,
    });
  }

  return sections;
}

/** Pull "08/17/2026 to 12/11/2026" → start "2026-08-17". */
function extractTermStartDate(text: string): string {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+to\s+\d{2}\/\d{2}\/\d{4}/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

async function main() {
  const args = process.argv.slice(2);
  const pdfArgIdx = args.indexOf("--pdf");
  const termArgIdx = args.indexOf("--term");
  const noImport = args.includes("--no-import");

  console.log("Diné College PDF schedule scraper");

  let pdfTargets: { url: string; term: string; localPath?: string }[];
  if (pdfArgIdx >= 0 && termArgIdx >= 0) {
    pdfTargets = [
      { url: "local", term: args[termArgIdx + 1], localPath: args[pdfArgIdx + 1] },
    ];
  } else {
    pdfTargets = await fetchSchedulePagePdfs();
    if (pdfTargets.length === 0) {
      console.log("  No matching schedule PDFs found at", SCHEDULE_PAGE_URL);
      return;
    }
    console.log(`  Found ${pdfTargets.length} PDF(s):`);
    for (const p of pdfTargets) console.log(`    ${p.term}: ${p.url}`);
  }

  let grandTotal = 0;
  for (const target of pdfTargets) {
    console.log(`\n=== ${target.term} ===`);
    let localPath = target.localPath;
    if (!localPath) {
      console.log(`  Downloading ${target.url}…`);
      localPath = await downloadPdf(target.url);
    }
    const text = pdfToText(localPath);
    const startDate = extractTermStartDate(text);
    const sections = parsePdfText(text, {
      termCode: target.term,
      termName: target.term,
      termStartDate: startDate,
    });
    if (sections.length === 0) {
      console.log(`  ${target.term}: parsed 0 sections (PDF layout may have changed)`);
      continue;
    }
    const outDir = path.join(process.cwd(), "data", "az", "courses", COLLEGE_SLUG);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${target.term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
    console.log(`  ✓ ${sections.length} sections → ${outPath}`);
    grandTotal += sections.length;
  }

  console.log(`\nTotal: ${grandTotal} sections across ${pdfTargets.length} term(s)`);

  if (!noImport && grandTotal > 0) {
    try {
      const { importCoursesToSupabase } = await import("../lib/supabase-import");
      await importCoursesToSupabase("az");
    } catch (e) {
      console.log(`Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
