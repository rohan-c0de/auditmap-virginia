/**
 * Brazosport College — bespoke Campus Management Corp (CMC) WebForms scrape
 *
 * Brazosport publishes a fully public class schedule (no SSO, no login) via a
 * Campus Management Corp ASP.NET WebForms portal:
 *
 *   https://mybcnext.brazosport.edu/CMCPortal/Common/CourseSchedule.aspx
 *
 * The page is a classic `__VIEWSTATE` / `__EVENTVALIDATION` postback form.
 * The contract (verified live 2026-06-08):
 *
 *   1. A *cold* request to the portal returns a transient 500
 *      (`InternalError.aspx`) and never sets the `ASP.NET_SessionId` cookie.
 *      You must first GET the portal root `/CMCPortal/` to establish the
 *      session, THEN GET `Common/CourseSchedule.aspx` carrying that cookie.
 *      Node's global `fetch` mishandles the `Secure; HttpOnly` session cookie
 *      across the redirect, so this scraper shells out to `curl` with a
 *      cookie-jar file — curl drives the exact sequence reliably (4/4 runs).
 *
 *   2. The search form fields (ASP.NET `_ctl0:PlaceHolderMain:_ctl0:*` style):
 *        _ctl0:PlaceHolderMain:_ctl0:cbTerm        term <select> (e.g. 1207)
 *        _ctl0:PlaceHolderMain:_ctl0:cbCampus      campus <select>; "5" = Brazosport MAIN
 *        _ctl0:PlaceHolderMain:_ctl0:Sections      radio; "rbOC" = Open & Closed
 *        _ctl0:PlaceHolderMain:_ctl0:cbCourseType  "-1" = *All*
 *        _ctl0:PlaceHolderMain:_ctl0:cbCourseAttribute  "-1" = *All*
 *        _ctl0:PlaceHolderMain:_ctl0:cbLowTime / cbHighTime  "0".."23"
 *        _ctl0:PlaceHolderMain:_ctl0:chkMo..chkSu  day checkboxes (all "on")
 *        _ctl0:PlaceHolderMain:_ctl0:chbDeliveryMethod:chbDeliveryMethod_0..8 (all "on")
 *        _ctl0:PlaceHolderMain:_ctl0:btnSearch     submit = "Search"
 *      All hidden ViewState fields are echoed back verbatim from the GET.
 *
 *   3. The result is a single full HTML page (no server-side paging — the
 *      grid is a client-side DataTables, so ONE POST per term returns every
 *      section). The grid is `<table id="CourseList">` with 12 columns:
 *        0 Course code (e.g. "EDUC1300")   6 Instructor ("Last,First")
 *        1 Course Title                    7 Delivery Method
 *        2 Section Code ("02")             8 Course Attribute (dept tags)
 *        3 Term Period ("8/24/2026 to …")  9 Class Comments
 *        4 Credits ("3.00")               10 Avail Seats ("28 of 28" = open/total)
 *        5 Schedule ("TR 7:30AM - 8:45AM" 11 details link (ignored)
 *           or "No Scheduled Meetings")
 *      There is NO room/location column — `campus` is the campus we filtered
 *      on ("Brazosport MAIN Campus"); `location` is left blank.
 *
 * Term-label → standard code (per project convention YEAR+FA/SP/SU):
 *   "2026-27 Fall - 16 Week"   → 2026FA
 *   "2025-26 Summer - 11 Week" → 2026SU   (summer at the END of AY 2025-26)
 * Only current/future terms (year >= current calendar year) are scraped.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-brazosport.ts
 *   npx tsx scripts/tx/scrape-brazosport.ts --term=1207   # single term value
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import * as cheerio from "cheerio";

const SLUG = "brazosport-college";
const STATE = "tx";
const BASE = "https://mybcnext.brazosport.edu";
const ROOT = `${BASE}/CMCPortal/`;
const SCHED = `${BASE}/CMCPortal/Common/CourseSchedule.aspx`;
const CAMPUS_VALUE = "5"; // Brazosport MAIN Campus
const CAMPUS_LABEL = "Brazosport MAIN Campus";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const P = "_ctl0:PlaceHolderMain:_ctl0:";

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface TermOption {
  value: string;
  label: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// curl-backed cookie-jar HTTP (Node fetch can't carry the Secure;HttpOnly
// ASP.NET_SessionId cookie across the warm-up redirect on this portal).
// ---------------------------------------------------------------------------

function curlGet(url: string, jar: string, referer?: string): string {
  const args = [
    "-s",
    "--compressed",
    "-A",
    UA,
    "-c",
    jar,
    "-b",
    jar,
    "-L",
    "--max-time",
    "120",
  ];
  if (referer) args.push("-e", referer);
  args.push(url);
  return execFileSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function curlPost(
  url: string,
  jar: string,
  bodyFile: string,
  referer: string
): string {
  const args = [
    "-s",
    "--compressed",
    "-A",
    UA,
    "-c",
    jar,
    "-b",
    jar,
    "-e",
    referer,
    "-H",
    "Content-Type: application/x-www-form-urlencoded",
    "-H",
    `Origin: ${BASE}`,
    "--data-binary",
    `@${bodyFile}`,
    "-L",
    "--max-time",
    "180",
    url,
  ];
  return execFileSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Establish a session and return the loaded course-search form HTML. Retries
 * because the very first cold hit of the portal occasionally 500s before the
 * session is warm.
 */
function loadForm(jar: string): string {
  for (let attempt = 1; attempt <= 6; attempt++) {
    // Warm the session at the portal root (sets ASP.NET_SessionId).
    curlGet(ROOT, jar);
    const html = curlGet(SCHED, jar, ROOT);
    if (html.length > 50_000 && /cbTerm/.test(html)) return html;
    if (attempt < 6) {
      console.log(
        `  form load attempt ${attempt}: got ${html.length} bytes, retrying…`
      );
    }
  }
  throw new Error("could not load CourseSchedule form (portal may be down)");
}

// ---------------------------------------------------------------------------
// Form-field collection + postback body
// ---------------------------------------------------------------------------

/**
 * Snapshot every successful-control field on the form exactly as a browser
 * would submit it: text inputs by value, checked checkboxes/radios by value,
 * selects by their selected (or first) option. Submit buttons are excluded —
 * we add only the one we "click".
 */
function collectForm($: cheerio.CheerioAPI): Record<string, string> {
  const f: Record<string, string> = {};
  $("input").each((_i, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const type = ($(el).attr("type") || "").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if ($(el).attr("checked") !== undefined) f[name] = $(el).attr("value") || "on";
      return;
    }
    if (type === "submit" || type === "button" || type === "image") return;
    f[name] = $(el).attr("value") || "";
  });
  $("select").each((_i, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const sel = $(el).find("option[selected]").attr("value");
    f[name] = sel !== undefined ? sel : $(el).find("option").first().attr("value") || "";
  });
  return f;
}

function getTerms($: cheerio.CheerioAPI): TermOption[] {
  const out: TermOption[] = [];
  $(`select[name="${P}cbTerm"] option`).each((_i, o) => {
    const value = ($(o).attr("value") || "").trim();
    const label = $(o).text().trim();
    if (value && value !== "-1" && label) out.push({ value, label });
  });
  return out;
}

/**
 * "2026-27 Fall - 16 Week"   → "2026FA"
 * "2025-26 Summer - 11 Week" → "2026SU"  (summer at the END of the AY range)
 * "2026-27 Spring …"         → "2027SP"  (spring at the END of the AY range)
 *
 * Brazosport labels every term with an academic-year prefix like "2025-26".
 * Fall belongs to the FIRST year of the range; Spring and Summer belong to
 * the SECOND. We derive the calendar year from the range accordingly.
 */
function termLabelToCode(label: string): string | null {
  const m = label.match(/(\d{4})\s*-\s*(\d{2,4})\s+(Fall|Spring|Summer|Winter)/i);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  // Normalize the 2-or-4-digit end year ("26" → 2026, "2027" → 2027).
  let endYear = parseInt(m[2], 10);
  if (endYear < 100) endYear = Math.floor(startYear / 100) * 100 + endYear;
  const season = m[3].toLowerCase();
  if (season === "fall") return `${startYear}FA`;
  if (season === "spring") return `${endYear}SP`;
  if (season === "summer") return `${endYear}SU`;
  if (season === "winter") return `${startYear}WI`;
  return null;
}

function pickFutureTerms(terms: TermOption[]): TermOption[] {
  const thisYear = new Date().getFullYear();
  return terms.filter((t) => {
    const code = termLabelToCode(t.label);
    if (!code) return false;
    const y = parseInt(code.slice(0, 4), 10);
    return y >= thisYear;
  });
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

function parseCourseCode(raw: string): { prefix: string; number: string } | null {
  // "EDUC1300", "ENGL0201 ##" → strip to the leading PREFIX+NUMBER token.
  const m = raw.replace(/\s+/g, " ").trim().match(/^([A-Z]{2,4})\s*(\d{3,4}[A-Z]?)/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

const DAY_TOKEN_RE = /^[MTWRFSU]+$/;

/**
 * "TR 7:30AM - 8:45AM" → { days:"TR", start:"7:30 AM", end:"8:45 AM" }
 * "No Scheduled Meetings" / "" → all blank.
 */
function parseSchedule(raw: string): {
  days: string;
  start_time: string;
  end_time: string;
} {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s || /no scheduled meetings/i.test(s)) {
    return { days: "", start_time: "", end_time: "" };
  }
  const m = s.match(
    /^([MTWRFSU]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i
  );
  if (!m || !DAY_TOKEN_RE.test(m[1])) {
    return { days: "", start_time: "", end_time: "" };
  }
  const norm = (t: string) => t.replace(/\s+/g, "").replace(/([AP]M)$/i, " $1").trim();
  return { days: m[1], start_time: norm(m[2]), end_time: norm(m[3]) };
}

/** "8/24/2026 to 12/10/2026" → "2026-08-24" (first date). */
function parseStartDate(raw: string): string {
  const m = (raw || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** "28 of 28" → open=28 total=28. Overbooked negatives clamp to 0 open. */
function parseSeats(raw: string): { open: number | null; total: number | null } {
  const m = (raw || "").match(/(-?\d+)\s+of\s+(\d+)/i);
  if (!m) return { open: null, total: null };
  const open = Math.max(0, parseInt(m[1], 10));
  const total = parseInt(m[2], 10);
  return { open, total };
}

/** "Brooks,Barrett" → "Brooks,Barrett"; "Unassigned,Unassigned"/"Staff"/"" → null. */
function parseInstructor(raw: string): string | null {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(unassigned|staff)\b/i.test(t) || /^(unassigned,\s*unassigned)$/i.test(t)) {
    return null;
  }
  return t;
}

/**
 * Classify mode from the explicit Delivery-Method column, which is more
 * reliable here than inferring from the schedule. Falls back to the
 * days-present heuristic when the delivery cell is blank/unknown.
 */
function classifyMode(delivery: string, days: string): CourseMode {
  const d = (delivery || "").toLowerCase();
  if (/zoom/.test(d)) return "zoom";
  if (/hybrid|blended/.test(d)) return "hybrid";
  if (/online|asynchronous|distance|web|internet/.test(d)) return "online";
  if (/face-to-face|face to face|in[\s-]?person|lecture|on[\s-]?campus/.test(d)) {
    return "in-person";
  }
  // Unknown delivery label → infer from schedule.
  return days ? "in-person" : "online";
}

function rowToSection(cells: string[], termCode: string): CourseSection | null {
  if (cells.length < 11) return null;
  const code = parseCourseCode(cells[0]);
  if (!code) return null;
  const title = (cells[1] || "").replace(/\s+/g, " ").trim();
  const section = (cells[2] || "").replace(/\s+/g, " ").trim();
  const { days, start_time, end_time } = parseSchedule(cells[5]);
  const { open, total } = parseSeats(cells[10]);
  const mode = classifyMode(cells[7], days);
  return {
    college_code: SLUG,
    term: termCode,
    course_prefix: code.prefix,
    course_number: code.number,
    course_title: title,
    credits: parseFloat(cells[4]) || 0,
    crn: section || `${code.prefix}-${code.number}-${section}`,
    days,
    start_time,
    end_time,
    start_date: parseStartDate(cells[3]),
    location: "",
    campus: CAMPUS_LABEL,
    mode,
    instructor: parseInstructor(cells[6]),
    seats_open: open,
    seats_total: total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function extractRows(html: string): string[][] {
  const $ = cheerio.load(html);
  const grid = $("#CourseList");
  if (grid.length === 0) return [];
  const trs = grid.find("tbody tr").length
    ? grid.find("tbody tr")
    : grid.find("tr").slice(1);
  const out: string[][] = [];
  trs.each((_i, tr) => {
    const cells = $(tr)
      .find("td")
      .map((_j, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length >= 11) out.push(cells);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Per-term scrape
// ---------------------------------------------------------------------------

function scrapeTerm(
  jar: string,
  baseForm: Record<string, string>,
  term: TermOption,
  termCode: string,
  tmpDir: string
): CourseSection[] {
  const f: Record<string, string> = { ...baseForm };
  // Search parameters.
  f[`${P}cbTerm`] = term.value;
  f[`${P}cbCampus`] = CAMPUS_VALUE;
  f[`${P}Sections`] = "rbOC"; // Open & Closed
  f[`${P}cbCourseType`] = "-1"; // *All*
  f[`${P}cbCourseAttribute`] = "-1"; // *All*
  f[`${P}cbLowTime`] = "0";
  f[`${P}cbHighTime`] = "23";
  f[`${P}txtKeyword`] = "";
  f[`${P}txtCode`] = "";
  // All weekdays + all delivery methods on.
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
    f[`${P}chk${d}`] = "on";
  }
  for (let i = 0; i <= 8; i++) {
    f[`${P}chbDeliveryMethod:chbDeliveryMethod_${i}`] = "on";
  }
  // Clear event fields and click Search.
  f["__EVENTTARGET"] = "";
  f["__EVENTARGUMENT"] = "";
  f["__LASTFOCUS"] = "";
  f[`${P}btnSearch`] = "Search";

  const body = new URLSearchParams(f).toString();
  const bodyFile = path.join(tmpDir, `body-${term.value}.txt`);
  fs.writeFileSync(bodyFile, body);

  let html = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    html = curlPost(SCHED, jar, bodyFile, SCHED);
    if (/id="CourseList"/.test(html)) break;
    if (/InternalError|Runtime Error/i.test(html) && attempt < 3) {
      console.log(`    POST attempt ${attempt} hit a transient error, retrying…`);
      continue;
    }
    break;
  }

  const rows = extractRows(html);
  const sections: CourseSection[] = [];
  for (const r of rows) {
    const sec = rowToSection(r, termCode);
    if (sec) sections.push(sec);
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const termArg = args.find((a) => a.startsWith("--term="))?.split("=")[1];

  console.log(`🐬 Brazosport College — CMC WebForms scrape`);
  console.log(`   ${SCHED}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "brazosport-"));
  const jar = path.join(tmpDir, "cookies.txt");

  const formHtml = loadForm(jar);
  const $ = cheerio.load(formHtml);
  const baseForm = collectForm($);
  console.log(
    `   form loaded: ${Object.keys(baseForm).length} fields ` +
      `(VIEWSTATE=${"__VIEWSTATE" in baseForm}, EVENTVALIDATION=${
        "__EVENTVALIDATION" in baseForm
      })`
  );

  const allTerms = getTerms($);
  let targets = pickFutureTerms(allTerms);
  if (termArg) targets = targets.filter((t) => t.value === termArg);
  console.log(
    `   ${allTerms.length} terms on page; ${targets.length} current/future target(s)`
  );

  // Group sections by standard term code (multiple sub-terms map to the same
  // YEAR+season bucket, e.g. Fall 16-Week + Fall 8-Week I/II + Fall Mini → FA).
  const byTerm = new Map<string, CourseSection[]>();
  // De-dupe across sub-terms by (prefix,number,section) — the same physical
  // section can appear under more than one sub-term filter.
  const seenByTerm = new Map<string, Set<string>>();

  for (const term of targets) {
    const code = termLabelToCode(term.label);
    if (!code) {
      console.log(`   skip "${term.label}" (${term.value}): can't map to a term code`);
      continue;
    }
    const sections = scrapeTerm(jar, baseForm, term, code, tmpDir);
    console.log(
      `   • ${term.label} (${term.value} → ${code}): ${sections.length} sections`
    );
    if (!byTerm.has(code)) {
      byTerm.set(code, []);
      seenByTerm.set(code, new Set());
    }
    const bucket = byTerm.get(code)!;
    const seen = seenByTerm.get(code)!;
    for (const sec of sections) {
      const key = `${sec.course_prefix}|${sec.course_number}|${sec.crn}|${sec.days}|${sec.start_time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push(sec);
    }
    await sleep(1200); // gentle pacing between term POSTs
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let grandTotal = 0;
  for (const [code, sections] of [...byTerm.entries()].sort()) {
    const outFile = path.join(OUT_DIR, `${code}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
    console.log(`   ✓ ${code}: ${sections.length} sections → ${outFile}`);
    grandTotal += sections.length;
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort temp cleanup */
  }

  console.log(`\n✅ ${grandTotal} sections across ${byTerm.size} terms.`);
  if (grandTotal === 0) {
    console.error("❌ No sections parsed — the form contract may have changed.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌ Brazosport scraper failed:", e);
  process.exit(1);
});
