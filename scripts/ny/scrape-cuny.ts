/**
 * scrape-cuny.ts
 *
 * Scrapes course section data for the 7 CUNY community colleges from CUNY
 * Global Class Search (https://globalsearch.cuny.edu/CFGlobalSearchTool/).
 *
 * Global Class Search is a single public CFML/JSP front end that wraps
 * CUNYfirst (PeopleSoft Campus Solutions) and exposes search to all 25 CUNY
 * institutions. v1 here covers only the 7 CUNY community colleges; SUNY is a
 * separate Phase 2 target (different system entirely).
 *
 * The search is a 3-step HTML form, not a REST API:
 *   Step 1: GET  search.jsp                     → receive JSESSIONID cookie
 *   Step 2: POST CFSearchToolController w/ inst_selection + term_value
 *                                               → "Criteria" page (subject list)
 *   Step 3: POST CFSearchToolController w/ subject_name + default filters
 *                                               → "Results" page (sections)
 *
 * Session state (institution + term) is held server-side, so we can re-POST
 * step 3 with different subjects without re-running step 2. Switching terms
 * or institutions requires a new step-2 POST. Switching institutions safely
 * is easiest with a fresh session, so we do one session per (college, term).
 *
 * Known v1 limitations:
 *   - Credits are not shown in the results table; defaulted to 3 (most common
 *     CUNY CC credit value). Courses with 4-credit labs will display as 3.
 *   - Seat counts are not shown; Open → seats_open=null, seats_total=null;
 *     Closed → seats_open=0, seats_total=null (correctly filtered as full).
 *   - Prerequisites are not scraped (would require a 4th per-class detail
 *     fetch; CUNY Global Search doesn't expose prereqs in results).
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-cuny.ts --college bmcc
 *   npx tsx scripts/ny/scrape-cuny.ts --college bmcc --term 1262
 *   npx tsx scripts/ny/scrape-cuny.ts --all
 *   npx tsx scripts/ny/scrape-cuny.ts --all --no-import
 */

import fs from "fs";
import path from "path";

const BASE_URL = "https://globalsearch.cuny.edu/CFGlobalSearchTool";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Polite delay between HTTP calls to avoid hammering the server.
const REQUEST_DELAY_MS = 300;

// CUNY institution codes from the Global Search institution checkboxes.
// The "name" field is the exact label text used in the selectedInstName hidden
// field (note the trailing " | " — CUNY joins multi-institution selections
// with " | ", and single selections still get a trailing separator).
const CUNY_COLLEGES: Record<string, { code: string; name: string }> = {
  "bmcc": { code: "BMC01", name: "Borough of Manhattan CC" },
  "bronx-cc": { code: "BCC01", name: "Bronx CC" },
  "guttman-cc": { code: "NCC01", name: "Guttman CC" },
  "hostos-cc": { code: "HOS01", name: "Hostos CC" },
  "kingsborough-cc": { code: "KCC01", name: "Kingsborough CC" },
  "laguardia-cc": { code: "LAG01", name: "LaGuardia CC" },
  "queensborough-cc": { code: "QCC01", name: "Queensborough CC" },
};

// CUNY term codes follow PeopleSoft: 1 + YY + season (2=Spring, 6=Summer, 9=Fall).
// Scrape the 3 active terms visible in the term_value dropdown. When CUNY
// publishes next year's terms, add them here — the dropdown is parsed only
// for verification, not as the source of truth, so old codes won't break.
interface CunyTerm {
  code: string;
  name: string;
  standard: string;
}

const CUNY_TERMS: CunyTerm[] = [
  { code: "1262", name: "2026 Spring Term", standard: "2026SP" },
  { code: "1266", name: "2026 Summer Term", standard: "2026SU" },
  { code: "1269", name: "2026 Fall Term", standard: "2026FA" },
];

// ---------------------------------------------------------------------------
// HTTP session with manual cookie jar
// ---------------------------------------------------------------------------

class Session {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private absorbSetCookies(res: Response): void {
    // Node 18+ fetch exposes getSetCookie() for multi-value headers.
    const raw = (res.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie?.() ?? [];
    for (const line of raw) {
      const first = line.split(";")[0];
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }

  async get(url: string): Promise<string> {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: this.cookieHeader(),
      },
      redirect: "manual",
    });
    this.absorbSetCookies(res);
    return res.text();
  }

  async postForm(
    url: string,
    fields: Record<string, string | string[]>
  ): Promise<string> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) {
        for (const item of v) body.append(k, item);
      } else {
        body.append(k, v);
      }
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Cookie: this.cookieHeader(),
        Referer: `${BASE_URL}/search.jsp`,
      },
      body: body.toString(),
      redirect: "manual",
    });
    this.absorbSetCookies(res);
    return res.text();
  }
}

// ---------------------------------------------------------------------------
// Step 1 / 2 / 3
// ---------------------------------------------------------------------------

async function initSession(session: Session): Promise<void> {
  // GET the search page to establish JSESSIONID.
  await session.get(`${BASE_URL}/search.jsp`);
}

async function selectInstitutionTerm(
  session: Session,
  instCode: string,
  instName: string,
  termCode: string,
  termName: string
): Promise<string> {
  // POST to CFSearchToolController with the institution + term. Returns the
  // "Criteria" page HTML (which contains the subject dropdown).
  return session.postForm(`${BASE_URL}/CFSearchToolController`, {
    inst_selection: instCode,
    selectedInstName: `${instName} | `,
    term_value: termCode,
    selectedTermName: termName,
    next_btn: "Next",
  });
}

async function searchSubject(
  session: Session,
  subjectCode: string,
  subjectLabel: string,
  career: { code: string; label: string } | null
): Promise<string> {
  // POST step 3 with subject + default dropdown values. The "selected*Name"
  // hidden fields mirror the human-readable text of each dropdown — CUNY's
  // server validates that they're populated, so we must include them even
  // though they're cosmetic.
  //
  // `career` is the single non-empty courseCareer option parsed from the
  // Criteria page. Some CUNY colleges (e.g. Kingsborough) require a second
  // criterion beyond subject; passing the college's own course career
  // satisfies that rule without narrowing results (it's the only career
  // available for that institution).
  return session.postForm(`${BASE_URL}/CFSearchToolController`, {
    subject_name: subjectCode,
    selectedSubjectName: subjectLabel,
    courseCareer: career?.code ?? "",
    selectedCCareerName: career?.label ?? "",
    courseAttr: "",
    selectedCAttrName: "",
    courseAttValue: "",
    selectedCAttrVName: "",
    reqDesignation: "",
    selectedReqDName: "",
    class_session: "",
    selectedSessionName: "",
    selectedModeInsName: "",
    meetingStart: "LT",
    selectedMeetingStartName: "less than",
    meetingStartText: "",
    AndMeetingStartText: "",
    meetingEnd: "LE",
    selectedMeetingEndName: "less than or equal to",
    meetingEndText: "",
    AndMeetingEndText: "",
    daysOfWeek: "I",
    selectedDaysOfWeekName: "include only these days",
    instructor: "B",
    selectedInstructorName: "begins with",
    instructorName: "",
    search_btn_search: "Search",
  });
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

/**
 * Extract the subject dropdown options from the Criteria page. Each option
 * value is the CUNY subject filter key (e.g. "ACCT"), and the label is the
 * human description ("Accounting"). Both are required for step 3.
 */
function parseSubjectOptions(
  html: string
): { code: string; label: string }[] {
  const m = html.match(
    /<select[^>]*name=["']subject_name["'][^>]*>([\s\S]*?)<\/select>/i
  );
  if (!m) return [];
  const opts: { code: string; label: string }[] = [];
  const optRe = /<option[^>]*value=["']([^"']*)["'][^>]*>([^<]+)<\/option>/gi;
  let om: RegExpExecArray | null;
  while ((om = optRe.exec(m[1])) !== null) {
    const code = om[1].trim();
    const label = decodeHtml(om[2]);
    if (!code) continue; // skip the blank placeholder
    opts.push({ code, label });
  }
  return opts;
}

/**
 * Extract the courseCareer dropdown from the Criteria page.
 *
 * Some CUNY institutions (e.g. Kingsborough) enforce a server-side rule
 * requiring at least 2 search criteria before returning results. The subject
 * alone is not enough — without a second criterion, the search returns
 * "Select at least 2 search criteria" and zero sections.
 *
 * Every CUNY CC's criteria page has a courseCareer dropdown with exactly one
 * non-empty option (e.g. "UGRD" for BMCC, "UKCC" for Kingsborough). Picking
 * that single career as the second criterion satisfies the validation without
 * narrowing the result set, since it's the only career available anyway. This
 * is a no-op for institutions that don't enforce the rule.
 */
function parseCourseCareer(
  html: string
): { code: string; label: string } | null {
  const m = html.match(
    /<select[^>]*name=["']courseCareer["'][^>]*>([\s\S]*?)<\/select>/i
  );
  if (!m) return null;
  const optRe = /<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)<\/option>/gi;
  let om: RegExpExecArray | null;
  while ((om = optRe.exec(m[1])) !== null) {
    const code = om[1].trim();
    if (!code) continue; // skip the blank placeholder
    return { code, label: decodeHtml(om[2]) };
  }
  return null;
}

interface RawSection {
  coursePrefix: string;
  courseNumber: string;
  courseTitle: string;
  classNumber: string;
  section: string;
  daysAndTimes: string;
  room: string;
  instructor: string;
  instructionMode: string;
  meetingDates: string;
  statusText: string;
}

/**
 * Walk the Results HTML and extract one RawSection per section row.
 *
 * CUNY groups sections by course with a span header like:
 *   <img src="images/expand_subject.gif" ...>&nbsp;ACC&nbsp;122&nbsp;-&nbsp;Accounting Principles I</span>
 * followed by <tr> rows inside the course's inner table (each with
 * data-label="Class" / "Section" / etc.).
 */
function parseResults(html: string): RawSection[] {
  const sections: RawSection[] = [];

  // Short-circuit on empty result pages (no sections found, error, etc.).
  if (!/class section/i.test(html)) return sections;

  // Split on course group headers. Each header contains "expand_subject.gif"
  // followed by "&nbsp;PREFIX&nbsp;NUMBER&nbsp;-&nbsp;TITLE</span>".
  const headerRe =
    /expand_subject\.gif[^>]*>\s*<\/a>&nbsp;([A-Z][A-Z0-9]{1,7})&nbsp;([0-9]{2,5}[A-Z]?)&nbsp;-&nbsp;([^<]+)<\/span>/g;

  const headers: Array<{
    prefix: string;
    number: string;
    title: string;
    start: number;
    end: number;
  }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(html)) !== null) {
    headers.push({
      prefix: hm[1].trim(),
      number: hm[2].trim(),
      title: decodeHtml(hm[3]),
      start: hm.index,
      end: hm.index + hm[0].length,
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const head = headers[i];
    const blockEnd =
      i + 1 < headers.length ? headers[i + 1].start : html.length;
    const block = html.slice(head.end, blockEnd);

    // Extract each <tr> row in the block that contains data-label="Class".
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tm: RegExpExecArray | null;
    while ((tm = trRe.exec(block)) !== null) {
      const row = tm[1];
      if (!/data-label=["']Class["']/i.test(row)) continue;

      const get = (label: string): string => {
        const re = new RegExp(
          `<td[^>]*data-label=["']${label}["'][^>]*>([\\s\\S]*?)<\\/td>`,
          "i"
        );
        const cm = row.match(re);
        return cm ? cm[1] : "";
      };

      const classNumber = stripTags(get("Class"));
      if (!classNumber || !/^\d+$/.test(classNumber)) continue;

      const sectionText = stripTags(get("Section"));
      const daysAndTimes = stripTags(get("DaysAndTimes"));
      const room = stripTags(get("Room"));
      const instructor = stripTags(get("Instructor"));
      const instructionMode = stripTags(get("Instruction Mode"));
      const meetingDates = stripTags(get("Meeting Dates"));

      // Status column contains an <img> with title="Open" or title="Closed".
      const statusCell = get("Status");
      const stm = statusCell.match(/title\s*=\s*["']([^"']+)["']/i);
      const statusText = stm ? stm[1].trim() : stripTags(statusCell);

      sections.push({
        coursePrefix: head.prefix,
        courseNumber: head.number,
        courseTitle: head.title,
        classNumber,
        section: sectionText,
        daysAndTimes,
        room,
        instructor,
        instructionMode,
        meetingDates,
        statusText,
      });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Conversion to course row format
// ---------------------------------------------------------------------------

// CUNY day prefixes in results: Mo, Tu, We, Th, Fr, Sa, Su.
// Our standard uses 1-letter for M/W/F and 2-letter for Tu/Th/Sa/Su.
function parseDays(daysAndTimes: string): string {
  // daysAndTimes looks like "MoWe 7:00AM - 8:40AM", "TuTh 8:00AM - 9:40AM",
  // or "TBA" for async/independent study.
  const m = daysAndTimes.match(/^([A-Za-z]+)\s/);
  if (!m) return "";
  const raw = m[1];
  // Walk the 2-char-at-a-time prefix list.
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const two = raw.slice(i, i + 2);
    switch (two) {
      case "Mo":
        out.push("M");
        i += 2;
        break;
      case "Tu":
        out.push("Tu");
        i += 2;
        break;
      case "We":
        out.push("W");
        i += 2;
        break;
      case "Th":
        out.push("Th");
        i += 2;
        break;
      case "Fr":
        out.push("F");
        i += 2;
        break;
      case "Sa":
        out.push("Sa");
        i += 2;
        break;
      case "Su":
        out.push("Su");
        i += 2;
        break;
      default:
        // Unknown prefix — bail out rather than misparse.
        return "";
    }
  }
  return out.join("");
}

function parseTimeRange(
  daysAndTimes: string
): { start: string; end: string } {
  // "MoWe 7:00AM - 8:40AM" → start="7:00 AM", end="8:40 AM"
  // "TBA" or "" → both empty.
  const m = daysAndTimes.match(
    /(\d{1,2}:\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)/i
  );
  if (!m) return { start: "", end: "" };
  return {
    start: `${m[1]} ${m[2].toUpperCase()}`,
    end: `${m[3]} ${m[4].toUpperCase()}`,
  };
}

function parseStartDate(meetingDates: string): string {
  // "01/26/2026 - 05/26/2026" → "2026-01-26"
  const m = meetingDates.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function normalizeMode(instructionMode: string, room: string): string {
  const mode = instructionMode.toLowerCase();
  const r = room.toLowerCase();
  if (
    mode.includes("online") ||
    r.includes("online") ||
    r.includes("distance")
  ) {
    return "online";
  }
  if (mode.includes("hybrid")) return "hybrid";
  if (mode.includes("hyflex")) return "hybrid";
  if (mode.includes("in person")) return "in-person";
  return "in-person";
}

function statusToSeats(statusText: string): {
  seats_open: number | null;
  seats_total: number | null;
} {
  // CUNY Global Search only exposes Open/Closed — no seat counts. We
  // represent Closed as seats_open=0 so the "hide full sections" filter in
  // the schedule builder works, and Open as null/null (unknown, treat as
  // available).
  if (/closed|full|waitlist/i.test(statusText)) {
    return { seats_open: 0, seats_total: null };
  }
  return { seats_open: null, seats_total: null };
}

interface CourseOut {
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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function toCourseRows(
  raw: RawSection[],
  collegeSlug: string,
  termStandard: string
): CourseOut[] {
  return raw.map((s) => {
    const days = parseDays(s.daysAndTimes);
    const { start, end } = parseTimeRange(s.daysAndTimes);
    const { seats_open, seats_total } = statusToSeats(s.statusText);
    return {
      college_code: collegeSlug,
      term: termStandard,
      course_prefix: s.coursePrefix,
      course_number: s.courseNumber,
      course_title: s.courseTitle,
      credits: 3, // see v1 limitations in file header
      crn: s.classNumber,
      days,
      start_time: start,
      end_time: end,
      start_date: parseStartDate(s.meetingDates),
      location: s.room,
      campus: "Main",
      mode: normalizeMode(s.instructionMode, s.room),
      instructor: s.instructor || null,
      seats_open,
      seats_total,
      prerequisite_text: null,
      prerequisite_courses: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Per-college scrape
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeCollegeTerm(
  slug: string,
  cuny: { code: string; name: string },
  term: CunyTerm
): Promise<CourseOut[]> {
  const session = new Session();

  console.log(`  [${slug}] Initializing session…`);
  await initSession(session);
  await sleep(REQUEST_DELAY_MS);

  console.log(
    `  [${slug}] Selecting ${cuny.name} × ${term.name} (${term.code})`
  );
  const criteriaHtml = await selectInstitutionTerm(
    session,
    cuny.code,
    cuny.name,
    term.code,
    term.name
  );
  await sleep(REQUEST_DELAY_MS);

  if (!/Criteria/i.test(criteriaHtml)) {
    console.warn(
      `  [${slug}] WARN: step 2 did not return Criteria page (length=${criteriaHtml.length}).`
    );
    return [];
  }

  const subjects = parseSubjectOptions(criteriaHtml);
  const career = parseCourseCareer(criteriaHtml);
  console.log(
    `  [${slug}] Found ${subjects.length} subjects` +
      (career ? ` (career=${career.code})` : " (no career)")
  );

  const all: CourseOut[] = [];
  let subjectsProcessed = 0;

  for (const subj of subjects) {
    let resultsHtml: string;
    try {
      resultsHtml = await searchSubject(session, subj.code, subj.label, career);
    } catch (e) {
      console.warn(
        `  [${slug}]   ${subj.code}: fetch error ${(e as Error).message}`
      );
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    // A "no sections found" page is still valid — just skip.
    const foundMatch = resultsHtml.match(/(\d+)\s+class section/i);
    const count = foundMatch ? parseInt(foundMatch[1], 10) : 0;

    if (count === 0) {
      subjectsProcessed++;
      continue;
    }

    const raw = parseResults(resultsHtml);
    const rows = toCourseRows(raw, slug, term.standard);
    all.push(...rows);
    subjectsProcessed++;

    if (subjectsProcessed % 10 === 0 || subjectsProcessed === subjects.length) {
      console.log(
        `  [${slug}]   progress: ${subjectsProcessed}/${subjects.length} subjects, ${all.length} sections so far`
      );
    }
  }

  return all;
}

async function scrapeCollege(slug: string): Promise<number> {
  const cuny = CUNY_COLLEGES[slug];
  if (!cuny) {
    console.error(`Unknown college slug: ${slug}`);
    return 0;
  }

  console.log(`\n=== Scraping ${slug} (${cuny.name} / ${cuny.code}) ===`);

  const outDir = path.join(process.cwd(), "data", "ny", "courses", slug);
  fs.mkdirSync(outDir, { recursive: true });

  let total = 0;
  for (const term of CUNY_TERMS) {
    console.log(`\n  Term: ${term.name} (${term.code} → ${term.standard})`);
    try {
      const rows = await scrapeCollegeTerm(slug, cuny, term);
      if (rows.length === 0) {
        console.log(`  [${slug}] No sections for ${term.name}`);
        continue;
      }
      const outFile = path.join(outDir, `${term.standard}.json`);
      fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
      console.log(
        `  [${slug}] → ${rows.length} sections written to ${term.standard}.json`
      );
      total += rows.length;
    } catch (e) {
      console.error(`  [${slug}] Error scraping ${term.name}:`, e);
    }
  }

  console.log(`\n  ${slug}: ${total} total sections`);
  return total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const termFlag = args.indexOf("--term");
  const allFlag = args.includes("--all");
  const noImport = args.includes("--no-import");

  let targetSlugs: string[];

  if (allFlag) {
    targetSlugs = Object.keys(CUNY_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    if (!CUNY_COLLEGES[slug]) {
      console.error(`Unknown college: ${slug}`);
      console.error(`Available: ${Object.keys(CUNY_COLLEGES).join(", ")}`);
      process.exit(1);
    }
    targetSlugs = [slug];
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/ny/scrape-cuny.ts --college bmcc");
    console.log(
      "  npx tsx scripts/ny/scrape-cuny.ts --college bmcc --term 1262"
    );
    console.log("  npx tsx scripts/ny/scrape-cuny.ts --all");
    console.log("  npx tsx scripts/ny/scrape-cuny.ts --all --no-import");
    process.exit(0);
  }

  // Optional single-term scope — useful for quick smoke tests.
  let termScope: CunyTerm[] = CUNY_TERMS;
  if (termFlag >= 0) {
    const tc = args[termFlag + 1];
    termScope = CUNY_TERMS.filter((t) => t.code === tc);
    if (termScope.length === 0) {
      console.error(
        `Unknown term code: ${tc}. Available: ${CUNY_TERMS.map((t) => t.code).join(", ")}`
      );
      process.exit(1);
    }
    // Temporarily monkey-patch CUNY_TERMS to the scoped list.
    // scrapeCollege reads the module-level constant, so we reassign here.
    CUNY_TERMS.length = 0;
    CUNY_TERMS.push(...termScope);
  }

  let grandTotal = 0;
  const results: { slug: string; count: number }[] = [];

  for (const slug of targetSlugs) {
    const count = await scrapeCollege(slug);
    results.push({ slug, count });
    grandTotal += count;
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.count} sections`);
  }
  console.log(
    `  Total: ${grandTotal} sections across ${results.length} college(s)`
  );

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import(
      "../lib/supabase-import"
    );
    await importCoursesToSupabase("ny");
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
