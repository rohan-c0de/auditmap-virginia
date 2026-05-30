/**
 * scrape-4cd.ts — Contra Costa Community College District class schedule
 *
 * All three CCCCD colleges (Contra Costa, Diablo Valley, Los Medanos)
 * publish their schedule through a single ASP.NET WebForms search page
 * at webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx. The
 * page accepts ?trm={TERM}&loc={CAMPUS} query params to seed the search;
 * results are paginated 25/page via __doPostBack and VIEWSTATE.
 *
 * Term codes (4CD-specific):
 *   2026SP, 2026SU, 2026FA  (same as our internal fileTerm)
 * Location codes:
 *   ccc = Contra Costa College
 *   dvc = Diablo Valley College
 *   lmc = Los Medanos College
 *
 * Pagination protocol: GET the seed URL, parse 25 rows, then POST back
 * with all hidden inputs + __EVENTTARGET=ctl00$PlaceHolderMain$
 * dgSchedulesFromUrl$ctl29$ctl01 to advance to the next page. Each
 * response carries fresh VIEWSTATE; carry it forward to the next POST.
 *
 * Output: data/ca/courses/{contra-costa-college,diablo-valley-college,
 *                          los-medanos-college}/{2026SP|SU|FA}.json
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const BASE = "https://webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const COLLEGES = [
  { loc: "ccc", slug: "contra-costa-college",  label: "Contra Costa College" },
  { loc: "dvc", slug: "diablo-valley-college", label: "Diablo Valley College" },
  { loc: "lmc", slug: "los-medanos-college",   label: "Los Medanos College" },
];

const TERMS = [
  { code: "2026SP", name: "Spring 2026" },
  { code: "2026SU", name: "Summer 2026" },
  { code: "2026FA", name: "Fall 2026"   },
];

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: "in-person" | "online" | "hybrid" | "unknown";
  instructor: string;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

interface FormState {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  hidden: Record<string, string>;
  nextEventTarget: string | null;
  pageInfo: string; // e.g. "1 - 25 of 1700"
}

function extractFormState(html: string): FormState {
  const $ = cheerio.load(html);
  const get = (name: string) => $(`input[name="${name}"]`).attr("value") ?? "";
  const viewState = get("__VIEWSTATE");
  const viewStateGenerator = get("__VIEWSTATEGENERATOR");
  const eventValidation = get("__EVENTVALIDATION");
  const hidden: Record<string, string> = {};
  $("input[type='hidden']").each((_, el) => {
    const name = $(el).attr("name");
    if (name && !name.startsWith("__")) hidden[name] = $(el).attr("value") ?? "";
  });
  // The "Next" link is rendered as <a href="javascript:__doPostBack('ID','')">.
  const nextHref = $(".next-prev-table-row a").last().attr("href") ?? "";
  const tm = nextHref.match(/__doPostBack\('([^']+)'/);
  const nextEventTarget = tm ? tm[1] : null;
  const pageInfo = $("#ctl00_PlaceHolderMain_lblCurrentPageIndexFromUrl").text().trim();
  return { viewState, viewStateGenerator, eventValidation, hidden, nextEventTarget, pageInfo };
}

function parseRows(html: string, term: string, collegeSlug: string, collegeLabel: string): CourseSection[] {
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];
  $("#ctl00_PlaceHolderMain_dgSchedulesFromUrl > tbody > tr, #ctl00_PlaceHolderMain_dgSchedulesFromUrl > tr").each((idx, tr) => {
    if (idx === 0) return; // header
    const $tr = $(tr);
    if ($tr.hasClass("next-prev-table-row")) return;
    const tds = $tr.children("td").toArray();
    if (tds.length < 9) return; // not a data row

    const $t = (i: number) => $(tds[i]);
    const text = (i: number) => $t(i).text().replace(/\s+/g, " ").trim();

    const termCol = text(0);
    const locCol = text(1);
    if (!termCol || !locCol) return;

    const crn = $t(2).find("a").first().text().trim() || text(2);
    const courseLabel = $t(3).find("[id$=lblCourse]").text().trim();
    const dates = $t(3).find("[id$=lblDates]").text().trim();

    // Course label format: "ADJUS-030NC - Public Safety Oral Interview..."
    // Split on first " - " — left side has SUBJECT-NUMBER, right side is title.
    const cm = courseLabel.match(/^([A-Z]+)-([A-Z0-9]+)\s*-\s*(.+)$/);
    const prefix = cm ? cm[1] : "";
    const number = cm ? cm[2] : "";
    const title = cm ? cm[3].trim() : courseLabel;

    // Inner meeting-days grid: rows of [days, time, building, room]. Take the
    // first row that has time text; that's the primary meeting.
    let days = "", startTime = "", endTime = "", buildingRoom = "";
    $t(3).find(".grid-meetingdays > tbody > tr, .grid-meetingdays > tr").each((_, mtr) => {
      const cells = $(mtr).children("td").toArray();
      if (cells.length < 4) return;
      const timeTxt = $(cells[1]).text().replace(/\s+/g, " ").trim();
      if (!timeTxt) return; // skip empty rows
      if (!startTime) {
        days = $(cells[0]).text().replace(/\s+/g, " ").trim().replace(/ /g, "");
        const tm = timeTxt.match(/^([\dAPM:]+)\s*-\s*([\dAPM:]+)$/i);
        if (tm) { startTime = tm[1]; endTime = tm[2]; }
        const bldg = $(cells[2]).text().replace(/\s+/g, " ").trim();
        const room = $(cells[3]).text().replace(/\s+/g, " ").trim();
        buildingRoom = [bldg, room].filter((s) => s && s !== "OFF").join(" ");
      }
    });

    // Start date is the first half of "11/16/2026 - 12/11/2026"
    let startDateIso = "";
    const dm = dates.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dm) startDateIso = `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;

    const units = parseFloat(text(4));
    const instructor = text(5);
    const status = text(7);
    const seatsAvailRaw = text(8);
    const seatsOpen = /^\d+$/.test(seatsAvailRaw) ? parseInt(seatsAvailRaw, 10) : null;

    // Mode: ONLINE building, or "PART-ONL" / "ONLINE" location → online; otherwise in-person.
    const blob = `${buildingRoom} ${title}`.toLowerCase();
    const mode: CourseSection["mode"] =
      blob.includes("online") || blob.includes("part-onl") ? "online" :
      buildingRoom ? "in-person" :
      status.toLowerCase() === "closed" ? "unknown" : "unknown";

    sections.push({
      college_code: collegeSlug,
      term,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: isFinite(units) ? units : null,
      crn: String(crn),
      days: normalizeDays(days),
      start_time: normalizeTime(startTime),
      end_time: normalizeTime(endTime),
      start_date: startDateIso,
      location: buildingRoom,
      campus: collegeLabel,
      mode,
      instructor,
      seats_open: seatsOpen,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

function normalizeDays(days: string): string {
  if (!days || days === " " || days === " ") return "";
  // Already in "M W" / "T Th" form; just collapse whitespace.
  return days.replace(/\s+/g, " ").trim();
}

function normalizeTime(t: string): string {
  if (!t) return "";
  // "5:30PM" → "5:30 pm"; "9:00AM" → "9:00 am"
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return t.toLowerCase().replace(/\s+/g, "").trim();
  return `${parseInt(m[1], 10)}:${m[2]} ${m[3].toLowerCase()}`;
}

async function getInitial(term: string, loc: string): Promise<{ html: string; cookies: string }> {
  const url = `${BASE}?trm=${term}&loc=${loc}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie().join("; ") : (res.headers.get("set-cookie") ?? "");
  const html = await res.text();
  return { html, cookies: extractCookieJar(cookies) };
}

function extractCookieJar(setCookieHeader: string): string {
  // Coarse: keep only `key=value` pairs from each Set-Cookie line.
  if (!setCookieHeader) return "";
  return setCookieHeader
    .split(/, (?=[A-Za-z0-9_-]+=)/)
    .map((line) => line.split(";")[0])
    .join("; ");
}

async function postNext(formState: FormState, term: string, loc: string, cookies: string): Promise<{ html: string; cookies: string }> {
  if (!formState.nextEventTarget) throw new Error("no next event target");
  const url = `${BASE}?trm=${term}&loc=${loc}`;
  const body = new URLSearchParams({
    __EVENTTARGET: formState.nextEventTarget,
    __EVENTARGUMENT: "",
    __VIEWSTATE: formState.viewState,
    __VIEWSTATEGENERATOR: formState.viewStateGenerator,
    __EVENTVALIDATION: formState.eventValidation,
    ...formState.hidden,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
      Referer: url,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`POST ${url} → HTTP ${res.status}`);
  const newCookieHeader = res.headers.get("set-cookie") ?? "";
  const newCookies = newCookieHeader ? extractCookieJar(newCookieHeader) : cookies;
  const html = await res.text();
  return { html, cookies: newCookies };
}

async function scrapeCollegeTerm(college: typeof COLLEGES[0], term: typeof TERMS[0]): Promise<CourseSection[]> {
  console.log(`\n=== ${college.label} — ${term.name} ===`);
  let { html, cookies } = await getInitial(term.code, college.loc);
  const sections: CourseSection[] = [];
  const seenCrn = new Set<string>();
  let page = 1;
  const maxPages = 200;

  while (page <= maxPages) {
    const state = extractFormState(html);
    const batch = parseRows(html, term.code, college.slug, college.label);
    let added = 0;
    for (const s of batch) {
      if (!s.crn || seenCrn.has(s.crn)) continue;
      seenCrn.add(s.crn);
      sections.push(s);
      added++;
    }
    if (page === 1 || page % 5 === 0 || !state.nextEventTarget) {
      console.log(`  page ${page} (${state.pageInfo}): +${added} new (running total: ${sections.length})`);
    }
    if (!state.nextEventTarget) break;
    // The 4CD search page wraps "Next" at the last page (clicking it cycles
    // back to page 1 instead of disabling). Stop when pageInfo shows "Y of Y"
    // — that's the unambiguous end-of-data signal.
    const pi = state.pageInfo.match(/^\d+\s*-\s*(\d+)\s+of\s+(\d+)$/);
    if (pi && parseInt(pi[1], 10) >= parseInt(pi[2], 10)) break;
    // Tiny throttle.
    await new Promise((r) => setTimeout(r, 300));
    const next = await postNext(state, term.code, college.loc, cookies);
    html = next.html;
    cookies = next.cookies || cookies;
    page++;
  }
  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const termFilter = getArg("--term");
  const collegeFilter = getArg("--college");

  const collegesToRun = collegeFilter ? COLLEGES.filter((c) => c.loc === collegeFilter) : COLLEGES;
  const termsToRun = termFilter ? TERMS.filter((t) => t.name === termFilter || t.code === termFilter) : TERMS;

  for (const college of collegesToRun) {
    for (const term of termsToRun) {
      const dir = path.join(DATA_DIR, college.slug);
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${term.code}.json`);
      if (fs.existsSync(out)) {
        console.log(`SKIP ${out} (already exists)`);
        continue;
      }
      try {
        const sections = await scrapeCollegeTerm(college, term);
        fs.writeFileSync(out, JSON.stringify(sections, null, 2) + "\n");
        console.log(`  wrote ${sections.length} → ${out}`);
      } catch (err) {
        console.error(`  FAILED ${college.slug}/${term.code}: ${(err as Error).message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
