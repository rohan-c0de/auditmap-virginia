/**
 * scrape-yosemite.ts — Yosemite Community College District (California)
 *
 * Yosemite CCD has two colleges, each with its OWN public ASP.NET WebForms
 * class-search application. The app URL itself is the college discriminator —
 * each app returns only its own college's sections, no login required.
 *
 *   modesto-junior-college → https://myapps.yosemite.edu/mjcClassSearch/
 *   columbia-college       → https://myapps.yosemite.edu/ccClassSearch/
 *
 * Form mechanism (Approach A — pure HTTP, no browser):
 *   1. GET the app landing page. Parse __VIEWSTATE / __VIEWSTATEGENERATOR /
 *      __EVENTVALIDATION, the term dropdown (ctl00$ContentPlaceHolder1$ddl_Term)
 *      and the subject listbox (ctl00$ContentPlaceHolder1$lb_Subject).
 *   2. For each term, POST the form once with subject = "All" (the listbox has
 *      an "All" option that returns every subject in one shot), carrying the
 *      viewstate fields, the selected term, and the search button
 *      (ctl00$ContentPlaceHolder1$btn_Submit). The server replies 302 →
 *      SearchResult.aspx (state held in the session cookie), which we follow.
 *   3. Parse the results table #ctl00_ContentPlaceHolder1_tbl_Result.
 *
 * Results table columns (15):
 *   0 Row · 1 Name (course code e.g. "MENGL-105") · 2 Section (CRN, e.g. 6009)
 *   3 Title (+ <br> date range) · 4 Important Notes · 5 Instructor · 6 Units
 *   7 Location (+ ", campus"; multi-meeting joined by <br>) · 8 Type
 *   (LEC / DINT online / "LEC DINT" hybrid) · 9 Times ("2:20P - 3:45P" or
 *   "Online", multi-meeting joined by <br>) · 10 Days ("MW" / "ARR" async)
 *   11 Max/Avail ("31/14" = total/open) · 12 Status · 13 Books · 14 GE flags
 *
 * Term codes are college-prefixed: MJC = 2026MSU/2026MFA, Columbia =
 * 2026CSU/2026CFA. We map by the 4th char (S=Summer, F=Fall).
 *
 * course_prefix/course_number: parsed straight from the "Name" cell as
 * published — MJC keeps its M-prefix (MENGL → prefix "MENGL" number "105"),
 * Columbia keeps its C-prefix. We do NOT normalize to bare ENGL.
 *
 * Output: data/ca/courses/{modesto-junior-college,columbia-college}/<TERM>.json
 * where TERM ∈ {2026SU, 2026FA} (and 2026SP if ever exposed).
 *
 * Usage:
 *   tsx scripts/ca/scrape-yosemite.ts                       # both colleges, all terms
 *   tsx scripts/ca/scrape-yosemite.ts --college modesto-junior-college
 *   tsx scripts/ca/scrape-yosemite.ts --term 2026FA
 *   tsx scripts/ca/scrape-yosemite.ts --college columbia-college --term 2026SU
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface College {
  slug: string;
  base: string; // class-search app root, trailing slash
  name: string; // campus label
}

const COLLEGES: College[] = [
  {
    slug: "modesto-junior-college",
    base: "https://myapps.yosemite.edu/mjcClassSearch/",
    name: "Modesto",
  },
  {
    slug: "columbia-college",
    base: "https://myapps.yosemite.edu/ccClassSearch/",
    name: "Sonora",
  },
];

type Mode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: Mode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// Term-code mapping. Source dropdown values are college-prefixed (2026MFA /
// 2026CFA). Map to the output convention 2026FA/2026SU/2026SP via the season
// char at index 4.
// ---------------------------------------------------------------------------
const SEASON: Record<string, string> = { S: "SU", F: "FA", W: "SP" };

function termValueToFileTerm(value: string): string | null {
  // e.g. "2026MFA" → year "2026", season char "F" → "2026FA"
  const m = value.match(/^(\d{4})[A-Z]([A-Z])([A-Z])$/);
  if (!m) return null;
  const year = m[1];
  // Season is encoded in the suffix: SU=Summer, FA=Fall, SP=Spring.
  const suffix = value.slice(5); // "SU" | "FA" | "SP"
  if (suffix === "SU") return `${year}SU`;
  if (suffix === "FA") return `${year}FA`;
  if (suffix === "SP") return `${year}SP`;
  // Fallback by first season char.
  const seas = SEASON[m[2]];
  return seas ? `${year}${seas}` : null;
}

// ---------------------------------------------------------------------------
// HTTP helpers — maintain an ASP.NET session cookie jar across requests.
// ---------------------------------------------------------------------------
function parseSetCookies(headers: Headers, jar: Map<string, string>): void {
  // Node fetch exposes getSetCookie() for multiple Set-Cookie headers.
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  const cookies: string[] =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  for (const c of cookies) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// Cell parsers.
// ---------------------------------------------------------------------------

// "MENGL-105" → { prefix:"MENGL", number:"105" }; "MENGL-C1000E" → number "C1000E"
function parseCourseCode(name: string): { prefix: string; number: string } | null {
  const clean = name.trim();
  const idx = clean.indexOf("-");
  if (idx <= 0) return null;
  const prefix = clean.slice(0, idx).trim();
  const number = clean.slice(idx + 1).trim();
  if (!prefix || !number) return null;
  return { prefix, number };
}

// Convert MJC compressed time "2:20P" → "2:20 PM", " 9:35A" → "9:35 AM"
function normTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([AP])M?$/i);
  if (!m) return "";
  const hh = m[1];
  const mm = m[2];
  const ap = m[3].toUpperCase() === "A" ? "AM" : "PM";
  return `${hh}:${mm} ${ap}`;
}

// "2:20P -  3:45P" → ["2:20 PM","3:45 PM"]; "Online" / "ARR" / "TBA" → ["",""]
function parseTimes(cellText: string): [string, string] {
  // Multi-meeting cells separate by newline (was <br>). Take the first
  // meeting line that actually has a time range.
  const lines = cellText.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(.+?)-(.+)$/);
    if (m) {
      const s = normTime(m[1]);
      const e = normTime(m[2]);
      if (s && e) return [s, e];
    }
  }
  return ["", ""];
}

// Days "MW" (single) / "M\nARR" (multi) → first meeting's day tokens.
// MJC packs days as a contiguous string: M T W R F S U (T=Tue, R=Thu, etc.)
// plus full "TTH"/"SU" forms; ARR/TBA = async (no days).
function parseDays(cellText: string): string {
  const lines = cellText.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || "";
  const up = first.toUpperCase();
  if (!up || up === "ARR" || up === "TBA" || up === "TBD" || up === "ONLINE")
    return "";
  return dayStringToTokens(up);
}

// Translate a packed day string into space-joined schema tokens M Tu W Th F Sa Su.
function dayStringToTokens(up: string): string {
  const tokens: string[] = [];
  let i = 0;
  while (i < up.length) {
    const two = up.slice(i, i + 2);
    const three = up.slice(i, i + 3);
    if (three === "SUN") { tokens.push("Su"); i += 3; continue; }
    if (two === "TH") { tokens.push("Th"); i += 2; continue; }
    if (two === "SU") { tokens.push("Su"); i += 2; continue; }
    if (two === "SA") { tokens.push("Sa"); i += 2; continue; }
    const ch = up[i];
    switch (ch) {
      case "M": tokens.push("M"); break;
      case "T": tokens.push("Tu"); break; // bare T = Tuesday
      case "W": tokens.push("W"); break;
      case "R": tokens.push("Th"); break; // Banner-style R = Thursday
      case "F": tokens.push("F"); break;
      case "S": tokens.push("Sa"); break; // bare S = Saturday
      case "U": tokens.push("Su"); break;
      default: break; // skip separators/spaces
    }
    i += 1;
  }
  // De-dupe while preserving order.
  return [...new Set(tokens)].join(" ");
}

// "08/24/26-12/12/26" (from title cell) → start date "2026-08-24"
function parseStartDate(titleCellText: string): string {
  const m = titleCellText.match(/(\d{2})\/(\d{2})\/(\d{2})\s*-\s*\d{2}\/\d{2}\/\d{2}/);
  if (!m) return "";
  const yy = parseInt(m[3], 10);
  const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${yyyy}-${m[1]}-${m[2]}`;
}

// "31/14" → { total:31, open:14 }
function parseSeats(maxAvail: string): { total: number | null; open: number | null } {
  const m = maxAvail.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { total: null, open: null };
  return { total: parseInt(m[1], 10), open: parseInt(m[2], 10) };
}

// Derive modality from the Type column + location/times hints.
//   DINT only            → online
//   LEC/LAB/etc only     → in-person
//   mix of online + face → hybrid
//   anything "zoom"      → zoom
function deriveMode(typeText: string, locationText: string, timesText: string): Mode {
  const t = `${typeText} ${locationText} ${timesText}`.toLowerCase();
  if (t.includes("zoom")) return "zoom";
  const hasOnline =
    /\bdint\b/.test(t) || t.includes("online") || t.includes("canvas") ||
    t.includes("monl") || t.includes("conl") || /\barr\b/.test(t);
  const hasFace =
    /\blec\b|\blab\b|\bact\b|\bdis\b|\bsem\b/.test(t) &&
    /\d:\d{2}\s*[ap]/i.test(timesText); // a real clock time = an in-person meeting
  if (hasFace && hasOnline) return "hybrid";
  if (hasFace) return "in-person";
  if (hasOnline) return "online";
  // No clear signal: a real meeting time → in-person, else online.
  return /\d:\d{2}\s*[ap]/i.test(timesText) ? "in-person" : "online";
}

// Cell text that preserves <br> as newlines and strips other tags.
function cellText($: cheerio.CheerioAPI, td: AnyNode): string {
  const html = $(td).html() || "";
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  const text = cheerio.load(withBreaks).text();
  return decodeEntities(text).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

// ---------------------------------------------------------------------------
// Per-college, per-term scrape.
// ---------------------------------------------------------------------------

interface PrimedForm {
  viewstate: string;
  viewstateGen: string;
  eventValidation: string;
  terms: { value: string; fileTerm: string }[];
  subjectAll: string; // the value of the "All" subject option (usually "All")
}

async function primeForm(
  college: College,
  jar: Map<string, string>,
): Promise<PrimedForm> {
  const res = await fetch(college.base, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${college.base} → HTTP ${res.status}`);
  parseSetCookies(res.headers, jar);
  const html = await res.text();
  const $ = cheerio.load(html);

  const hidden = (id: string) =>
    ($(`#${id}`).attr("value") as string | undefined) ?? "";
  const viewstate = hidden("__VIEWSTATE");
  const viewstateGen = hidden("__VIEWSTATEGENERATOR");
  const eventValidation = hidden("__EVENTVALIDATION");
  if (!viewstate || !eventValidation)
    throw new Error(`${college.slug}: missing viewstate/eventvalidation`);

  const terms: { value: string; fileTerm: string }[] = [];
  $("#ctl00_ContentPlaceHolder1_ddl_Term option").each((_, opt) => {
    const v = ($(opt).attr("value") || "").trim();
    if (!v) return;
    const ft = termValueToFileTerm(v);
    if (ft) terms.push({ value: v, fileTerm: ft });
  });

  let subjectAll = "All";
  $("#ctl00_ContentPlaceHolder1_lb_Subject option").each((_, opt) => {
    const v = ($(opt).attr("value") || "").trim();
    const txt = $(opt).text().trim().toLowerCase();
    if (v.toLowerCase() === "all" || txt === "all") subjectAll = v;
  });

  return { viewstate, viewstateGen, eventValidation, terms, subjectAll };
}

async function searchTerm(
  college: College,
  form: PrimedForm,
  termValue: string,
  jar: Map<string, string>,
): Promise<string> {
  const body = new URLSearchParams();
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("__VIEWSTATE", form.viewstate);
  body.set("__VIEWSTATEGENERATOR", form.viewstateGen);
  body.set("__EVENTVALIDATION", form.eventValidation);
  body.set("__SCROLLPOSITIONX", "0");
  body.set("__SCROLLPOSITIONY", "0");
  body.set("ctl00$ContentPlaceHolder1$ddl_Term", termValue);
  // The listbox is multi-select; "All" selects every subject in one POST.
  body.set("ctl00$ContentPlaceHolder1$lb_Subject", form.subjectAll);
  body.set("ctl00$ContentPlaceHolder1$ddl_StartTime", "");
  body.set("ctl00$ContentPlaceHolder1$ddl_EndTime", "");
  body.set("ctl00$ContentPlaceHolder1$txt_CourseNo", "");
  body.set("ctl00$ContentPlaceHolder1$txt_SecNum", "");
  body.set("ctl00$ContentPlaceHolder1$txt_TitleKeyword", "");
  body.set("ctl00$ContentPlaceHolder1$txt_InstrName", "");
  body.set("ctl00$ContentPlaceHolder1$txt_StartDate", "");
  body.set("ctl00$ContentPlaceHolder1$txt_EndDate", "");
  body.set("ctl00$ContentPlaceHolder1$txtWaitLess", "");
  body.set("ctl00$ContentPlaceHolder1$ddl_ShortTermClasses", "");
  body.set("ctl00$ContentPlaceHolder1$btn_Submit", "Submit");

  // POST without auto-redirect so we can carry cookies into the GET that follows.
  const post = await fetch(college.base, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: college.base,
      Accept: "text/html",
    },
    body: body.toString(),
    redirect: "manual",
  });
  parseSetCookies(post.headers, jar);

  let resultUrl = new URL("SearchResult.aspx", college.base).toString();
  const loc = post.headers.get("location");
  if (loc) resultUrl = new URL(loc, college.base).toString();

  // If the POST returned the results body directly (200, no redirect), use it.
  if (post.status === 200) {
    const direct = await post.text();
    if (direct.includes("tbl_Result")) return direct;
  }

  const get = await fetch(resultUrl, {
    headers: {
      "User-Agent": UA,
      Referer: college.base,
      Accept: "text/html",
      Cookie: cookieHeader(jar),
    },
    redirect: "follow",
  });
  if (!get.ok) throw new Error(`GET ${resultUrl} → HTTP ${get.status}`);
  return await get.text();
}

function parseResults(
  html: string,
  college: College,
  fileTerm: string,
): CourseSection[] {
  const $ = cheerio.load(html);
  const table = $("#ctl00_ContentPlaceHolder1_tbl_Result");
  if (table.length === 0) return [];

  const sections: CourseSection[] = [];
  table.find("tr").each((_, tr) => {
    const tds = $(tr).children("td").toArray();
    if (tds.length < 13) return; // skip header / spacer rows

    const name = cellText($, tds[1]); // "MENGL-105"
    const crn = cellText($, tds[2]); // "6009"
    if (!crn || !/^\d+$/.test(crn)) return;

    const code = parseCourseCode(name);
    if (!code) return;

    const titleCell = cellText($, tds[3]); // "Creative Writing: Poetry\n08/24/26-12/12/26"
    const title = (titleCell.split("\n")[0] || "").trim();
    const startDate = parseStartDate(titleCell);

    const instructorRaw = cellText($, tds[5]).replace(/\n/g, "; ").trim();
    const instructor = instructorRaw ? instructorRaw : null;

    const unitsRaw = cellText($, tds[6]);
    const credits = parseFloat(unitsRaw) || 0;

    const locationCell = cellText($, tds[7]); // "MFND 277\n, East" or "MONL\n, Canvas"
    // First meeting's location; campus = text after the comma if present.
    const firstLocLine = (locationCell.split("\n").map((l) => l.trim()).filter(Boolean)[0]) || "";
    let location = firstLocLine.replace(/,\s*[A-Za-z]+\s*$/, "").trim();
    let campus = college.name; // default to college's canonical campus
    const campusMatch = firstLocLine.match(/,\s*([A-Za-z]+)\s*$/);
    if (campusMatch) campus = campusMatch[1];
    if (!location) location = "";

    const typeText = cellText($, tds[8]).replace(/\n/g, " ").trim();
    const timesCell = cellText($, tds[9]);
    const daysCell = cellText($, tds[10]);

    const [startTime, endTime] = parseTimes(timesCell);
    const days = parseDays(daysCell);
    const mode = deriveMode(typeText, locationCell, timesCell);

    const { total, open } = parseSeats(cellText($, tds[11]));

    sections.push({
      college_code: college.slug,
      term: fileTerm,
      course_prefix: code.prefix,
      course_number: code.number,
      course_title: title,
      credits,
      crn,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location,
      campus,
      mode,
      instructor,
      seats_open: open,
      seats_total: total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { college?: string; term?: string } {
  const out: { college?: string; term?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--college") out.college = argv[++i];
    else if (argv[i] === "--term") out.term = argv[++i];
  }
  return out;
}

async function scrapeCollege(
  college: College,
  termFilter: string | undefined,
): Promise<{ fileTerm: string; count: number; sample: CourseSection | null }[]> {
  const jar = new Map<string, string>();
  const form = await primeForm(college, jar);
  console.log(
    `[${college.slug}] terms on page: ${form.terms.map((t) => `${t.value}→${t.fileTerm}`).join(", ")}`,
  );

  const results: { fileTerm: string; count: number; sample: CourseSection | null }[] = [];
  for (const term of form.terms) {
    if (termFilter && term.fileTerm !== termFilter) continue;
    process.stdout.write(`[${college.slug}] ${term.value} (${term.fileTerm}) … `);
    try {
      const html = await searchTerm(college, form, term.value, jar);
      const sections = parseResults(html, college, term.fileTerm);
      console.log(`${sections.length} sections`);
      if (sections.length === 0) {
        // Write nothing for an empty term (no stub files).
        results.push({ fileTerm: term.fileTerm, count: 0, sample: null });
        continue;
      }
      const dir = path.join(DATA_DIR, college.slug);
      fs.mkdirSync(dir, { recursive: true });
      const outPath = path.join(dir, `${term.fileTerm}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
      results.push({ fileTerm: term.fileTerm, count: sections.length, sample: sections[0] });
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
      results.push({ fileTerm: term.fileTerm, count: 0, sample: null });
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const colleges = args.college
    ? COLLEGES.filter((c) => c.slug === args.college)
    : COLLEGES;
  if (colleges.length === 0) {
    console.error(`No college matched --college ${args.college}`);
    console.error(`Valid slugs: ${COLLEGES.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }

  let totalWritten = 0;
  for (const college of colleges) {
    try {
      const res = await scrapeCollege(college, args.term);
      for (const r of res) {
        if (r.count > 0 && r.sample) {
          totalWritten += r.count;
          console.log(
            `  ✓ ${college.slug} → ${r.fileTerm}: ${r.count} rows — ` +
              `sample CRN ${r.sample.crn} ${r.sample.course_prefix}-${r.sample.course_number} ` +
              `"${r.sample.course_title}"`,
          );
        }
      }
    } catch (err) {
      // HARD RULE: a college that fails writes nothing; report and move on.
      console.error(`✗ ${college.slug} FAILED entirely: ${(err as Error).message}`);
    }
  }
  console.log(`\nDone. Total rows written: ${totalWritten}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
