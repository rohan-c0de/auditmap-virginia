/**
 * scrape-deanza.ts — De Anza College class search
 *
 * De Anza (one of two Foothill-De Anza CCD colleges) exposes a public,
 * unauthenticated class search at https://deanza.edu/schedule/ . The
 * combined FHDA portal at myportal.fhda.edu is SSO-gated, but each campus
 * publishes its own schedule directly.
 *
 * The schedule form's JS does:
 *   window.location = '/schedule/listings.html?dept=' + DEPT + '&t=' + TERM
 * so we can hit that URL directly (GET) with a browser-like User-Agent. The
 * www. host is fronted by a Cloudflare WAF that 403s anything with a query
 * string; the bare deanza.edu host serves the listings cleanly.
 *
 * Per-section detail (credits, prereqs, start/end dates) lives at
 *   /schedule/class-details.html?crn=NNNNN&y=YYYY&q=Q
 * Credits and prereqs don't vary by section, so we cache one detail fetch
 * per unique (course_prefix, course_number) and apply to all sections.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-deanza.ts
 *   npx tsx scripts/ca/scrape-deanza.ts --term "Spring 2026"
 *   npx tsx scripts/ca/scrape-deanza.ts --term "Spring 2026" --dept ACCT
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const BASE = "https://deanza.edu/schedule";
const COLLEGE_SLUG = "de-anza-college";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses", COLLEGE_SLUG);

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://deanza.edu/schedule/",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

interface TermSpec {
  name: string;
  code: string;   // form value, e.g. "S2026"
  fileTerm: string; // output filename stem, e.g. "2026SP"
  y: string;
  q: string;
}

const TERMS: TermSpec[] = [
  { name: "Spring 2026", code: "S2026", fileTerm: "2026SP", y: "2026", q: "S" },
  { name: "Summer 2026", code: "M2026", fileTerm: "2026SU", y: "2026", q: "M" },
  { name: "Fall 2026",   code: "F2026", fileTerm: "2026FA", y: "2026", q: "F" },
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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface CourseDetail {
  credits: number | null;
  start_date: string;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function fetchHtml(url: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * (attempt + 1));
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Dept list — read from the schedule index page
// ---------------------------------------------------------------------------

async function fetchDeptCodes(): Promise<string[]> {
  const html = await fetchHtml(`${BASE}/`);
  const $ = cheerio.load(html);
  const codes: string[] = [];
  $("#dept-select option").each((_, el) => {
    const v = $(el).attr("value");
    if (v && v.trim()) codes.push(v.trim());
  });
  return codes;
}

// ---------------------------------------------------------------------------
// Listing parser
// ---------------------------------------------------------------------------

function parseDays(raw: string): string {
  // Input like "·T·R····" — middots are non-meeting slots, letters meet.
  // Strip middots and any whitespace; preserve letter order.
  return raw.replace(/[·•·\s]/g, "");
}

function parseTimes(raw: string): { start: string; end: string } {
  // "12:30 PM-02:45 PM" → start, end. "TBA" → both blank.
  const t = raw.trim();
  if (!t || /TBA/i.test(t)) return { start: "", end: "" };
  const m = t.match(/^(.+?)\s*-\s*(.+)$/);
  if (!m) return { start: t, end: "" };
  return { start: m[1].trim(), end: m[2].trim() };
}

function classifyMode(location: string, classInfo: string): string {
  const loc = location.toUpperCase();
  const info = classInfo.toUpperCase();
  if (loc.includes("ONLINE") || info.includes("ONLINE CLASS")) return "online";
  if (info.includes("HYBRID")) return "hybrid";
  if (loc === "TBA" || loc === "") return "tba";
  return "in-person";
}

function parseListingRows(html: string, term: TermSpec): CourseSection[] {
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];
  $("tr.mix").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 9) return;
    const crn = $(tds[0]).text().trim();
    const courseRaw = $(tds[1]).text().trim(); // "ACCT 1A"
    const seatsLabel = $(tds[3]).text().trim();
    // Title cell also has the footnote popover — take only the anchor text.
    const title = $(tds[4]).find("a").first().text().trim();
    const daysRaw = $(tds[5]).find("span.days").text() || $(tds[5]).text();
    const timesRaw = $(tds[6]).text().trim();
    const instructor = $(tds[7]).find("a").first().text().trim() || $(tds[7]).text().trim();
    const location = $(tds[8]).text().trim();
    const classInfo = tds.length > 9 ? $(tds[9]).text().trim() : "";

    const m = courseRaw.match(/^([A-Za-z/]+)\s+(\S+)/);
    if (!m) return;
    const prefix = m[1].toUpperCase();
    const number = m[2];

    const { start, end } = parseTimes(timesRaw);

    sections.push({
      college_code: COLLEGE_SLUG,
      term: term.fileTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: null,
      crn,
      days: parseDays(daysRaw),
      start_time: start,
      end_time: end,
      start_date: "",
      location,
      campus: "",
      mode: classifyMode(location, classInfo),
      instructor: instructor || null,
      seats_open: /open/i.test(seatsLabel) ? null : 0, // qualitative; numeric not surfaced in listing
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

// ---------------------------------------------------------------------------
// Detail parser — credits, prereqs, dates
// ---------------------------------------------------------------------------

function parseDetail(html: string): CourseDetail {
  const $ = cheerio.load(html);
  // De Anza emits a definition list of metadata:
  //   <dt>Units</dt><dd>5 Units</dd>
  //   <dt>Prerequisite</dt><dd>ACCT D001A or ACCT D01AH</dd>
  //   <dt>Advisory</dt><dd>...</dd>
  let credits: number | null = null;
  let prerequisite_text: string | null = null;
  $("dt").each((_, dt) => {
    const label = $(dt).text().trim().toLowerCase();
    const value = $(dt).next("dd").text().trim();
    if (label === "units") {
      const m = value.match(/(\d+(?:\.\d+)?)/);
      if (m) credits = parseFloat(m[1]);
    } else if (label === "prerequisite" || label === "prerequisites") {
      prerequisite_text = value || null;
    }
  });

  // Dates: "Class Dates: This class runs from 2026-04-06 to 2026-06-26."
  let start_date = "";
  const body = $("body").text();
  const dm = body.match(/Class\s+Dates:[^0-9]*(\d{4}-\d{2}-\d{2})/);
  if (dm) start_date = dm[1];

  const prerequisite_courses: string[] = [];
  if (prerequisite_text) {
    // De Anza prefixes course numbers with "D" in the catalog
    // ("ACCT D001A" vs the schedule's "ACCT 1A"). Normalize by stripping
    // the D and any leading zeros from the number, so the prereq references
    // match the section's course_prefix/course_number.
    const re = /\b([A-Z]{2,5})\s+D?0*([0-9]+[A-Z]{0,2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prerequisite_text)) !== null) {
      prerequisite_courses.push(`${m[1]} ${m[2]}`);
    }
  }

  return { credits, start_date, prerequisite_text, prerequisite_courses };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeTerm(
  term: TermSpec,
  depts: string[],
  filterDept: string | null,
): Promise<CourseSection[]> {
  const allSections: CourseSection[] = [];
  const detailCache = new Map<string, CourseDetail>();
  const targetDepts = filterDept ? depts.filter((d) => d === filterDept) : depts;

  for (let i = 0; i < targetDepts.length; i++) {
    const dept = targetDepts[i];
    const url = `${BASE}/listings.html?dept=${encodeURIComponent(dept)}&t=${term.code}`;
    let rows: CourseSection[] = [];
    try {
      const html = await fetchHtml(url);
      rows = parseListingRows(html, term);
    } catch (err) {
      console.warn(`  ${dept}: fetch failed (${(err as Error).message})`);
    }
    console.log(`  [${term.name}] ${dept} (${i + 1}/${targetDepts.length}) → ${rows.length} sections`);

    for (const sec of rows) {
      const key = `${sec.course_prefix} ${sec.course_number}`;
      let detail = detailCache.get(key);
      if (!detail) {
        const dUrl = `${BASE}/class-details.html?crn=${sec.crn}&y=${term.y}&q=${term.q}`;
        try {
          const dHtml = await fetchHtml(dUrl);
          detail = parseDetail(dHtml);
        } catch {
          detail = { credits: null, start_date: "", prerequisite_text: null, prerequisite_courses: [] };
        }
        detailCache.set(key, detail);
        await sleep(150);
      }
      sec.credits = detail.credits;
      sec.start_date = detail.start_date;
      sec.prerequisite_text = detail.prerequisite_text;
      sec.prerequisite_courses = [...detail.prerequisite_courses];
      allSections.push(sec);
    }
    await sleep(250);
  }
  return allSections;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };

  const termFilter = getArg("--term");
  const deptFilter = getArg("--dept");
  const termsToRun = termFilter
    ? TERMS.filter((t) => t.name === termFilter)
    : TERMS;
  if (termsToRun.length === 0) {
    console.error(`Unknown --term "${termFilter}". Valid: ${TERMS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  console.log("Fetching department list…");
  const depts = await fetchDeptCodes();
  console.log(`  ${depts.length} departments`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const term of termsToRun) {
    console.log(`\n=== ${term.name} (${term.code} → ${term.fileTerm}.json) ===`);
    const sections = await scrapeTerm(term, depts, deptFilter);
    if (sections.length === 0) {
      console.log(`  no sections for ${term.name}; skipping write`);
      continue;
    }
    const outPath = path.join(DATA_DIR, `${term.fileTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  wrote ${sections.length} sections → ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
