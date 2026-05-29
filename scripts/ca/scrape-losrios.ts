/**
 * scrape-losrios.ts — Los Rios Community College District class search
 *
 * All 4 LRCCD colleges (American River, Cosumnes River, Sacramento City,
 * Folsom Lake) share a single public class-search backend at
 *   https://hub.losrios.edu/classSearch/
 * exposed via the per-campus subdomains' /class-search page. The central
 * eServices PeopleSoft instance is not publicly reachable, but the
 * district's React-style search page proxies through hub.losrios.edu
 * with GET endpoints that any client can hit.
 *
 * Endpoints:
 *   GET getCourses.php?{filters}&offset=N&first=20  → 20-card HTML page
 *   GET getModal.php?CourseId=&ClassSection=&college=&modalStrm=  → course detail
 *
 * Strategy:
 *   • Fetch the term's subject list via getSubjectBoxes.php.
 *   • Per (college, term, subject), query getCourses.php with
 *     subjectFilters=SUBJ. The `first` param is ignored when a subject
 *     filter is set — the API returns ALL matching sections in one shot
 *     (verified: CHEM returns 32 regardless of first=5/10/20/100). The
 *     unfiltered "all subjects" query has a hard cap around 130 rows,
 *     which is why we iterate by subject instead of paginating offsets.
 *   • Parse each <article class="class-card"> for the section row.
 *   • Cache getModal.php fetches by (college, CourseId) — many sections of
 *     the same course share advisories/prereqs.
 *
 * Term codes (strm):
 *   1263 = Spring 2026   1266 = Summer 2026   1269 = Fall 2026
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-losrios.ts
 *   npx tsx scripts/ca/scrape-losrios.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-losrios.ts --term "Fall 2026" --college ARC
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const BASE = "https://hub.losrios.edu/classSearch";
const PAGE_SIZE = 20; // hub.losrios.edu caps LIMIT at 20 per page
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

interface TermSpec {
  name: string;
  strm: string;
  fileTerm: string;
  year: number;
}

const TERMS: TermSpec[] = [
  { name: "Spring 2026", strm: "1263", fileTerm: "2026SP", year: 2026 },
  { name: "Summer 2026", strm: "1266", fileTerm: "2026SU", year: 2026 },
  { name: "Fall 2026",   strm: "1269", fileTerm: "2026FA", year: 2026 },
];

interface CollegeSpec {
  code: "ARC" | "CRC" | "SCC" | "FLC";
  slug: string;
  hostPrefix: string; // for href= param & Referer
}

const COLLEGES: CollegeSpec[] = [
  { code: "ARC", slug: "american-river-college",   hostPrefix: "arc" },
  { code: "CRC", slug: "cosumnes-river-college",   hostPrefix: "crc" },
  { code: "SCC", slug: "sacramento-city-college",  hostPrefix: "scc" },
  { code: "FLC", slug: "folsom-lake-college",      hostPrefix: "flc" },
];

const SLUG_BY_CODE: Record<string, string> = Object.fromEntries(
  COLLEGES.map((c) => [c.code, c.slug]),
);

const HEADERS = (referer: string): Record<string, string> => ({
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: referer,
  Accept: "text/html,*/*",
});

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
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string, referer: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(url, { headers: HEADERS(referer) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < 2) {
      await sleep(1200 * (attempt + 1));
      return fetchHtml(url, referer, attempt + 1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Listing URL builder
// ---------------------------------------------------------------------------

function buildListingUrl(
  college: CollegeSpec,
  term: TermSpec,
  subject: string,
): string {
  const params = new URLSearchParams({
    arcFilter: college.code === "ARC" ? "true" : "false",
    crcFilter: college.code === "CRC" ? "true" : "false",
    flcFilter: college.code === "FLC" ? "true" : "false",
    sccFilter: college.code === "SCC" ? "true" : "false",
    openFilter: "false",
    waitlistFilter: "false",
    closedFilter: "false",
    onlineFilter: "false",
    AsynchronousFilter: "false",
    SynchronousFilter: "false",
    hybridFilter: "false",
    f2fFilter: "false",
    subjectFilters: subject,
    collegeLocationFilters: "",
    sessionFilters: "",
    dayFilters: "",
    unitSpan: "",
    timeSpan: "",
    zeroTextbook: "false",
    lowTextbook: "false",
    greenClean: "false",
    searchBar: "",
    clearAll: "false",
    instructorSearchName: "",
    strm: term.strm,
    href: college.hostPrefix,
    losRiosGEFilters: "",
    localGEFilters: "",
    calgetcFilters: "",
    csuGEFilters: "",
    igetcGEFilters: "",
    transferFilters: "",
    offset: "0",
    first: String(PAGE_SIZE),
  });
  return `${BASE}/getCourses.php?${params.toString()}`;
}

async function fetchSubjectsForTerm(strm: string, referer: string): Promise<string[]> {
  const url = `${BASE}/getSubjectBoxes.php?strm=${strm}&subs=`;
  const html = await fetchHtml(url, referer);
  const $ = cheerio.load(html);
  const subjects: string[] = [];
  $('input[name="subject"]').each((_, el) => {
    const v = $(el).attr("value");
    if (v && v.trim()) subjects.push(v.trim());
  });
  return subjects;
}

// ---------------------------------------------------------------------------
// Card parsing
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
};

function parseSessionStartDate(session: string, year: number): string {
  // "Full Term (August 22 to December 17)" → "2026-08-22"
  // "Late Start (October 5 to December 17)" → "2026-10-05"
  const m = session.match(/\(([A-Z][a-z]+)\s+(\d{1,2})\s+to\s+/);
  if (!m) return "";
  const month = MONTHS[m[1]];
  if (!month) return "";
  return `${year}-${month}-${m[2].padStart(2, "0")}`;
}

const DAY_MAP: Array<[RegExp, string]> = [
  [/Mon/i, "M"], [/Tue/i, "T"], [/Wed/i, "W"], [/Thu/i, "R"],
  [/Fri/i, "F"], [/Sat/i, "Sa"], [/Sun/i, "Su"],
];

function parseDaysAndTime(raw: string): { days: string; start: string; end: string } {
  // "Mon/Wed, 9:00 am to 10:20 am"
  // "Asynchronous – no scheduled meeting times"
  // "Tue, 6:00 pm to 7:20 pm"
  if (!raw || /asynchronous/i.test(raw)) return { days: "", start: "", end: "" };
  const parts = raw.split(/,\s*/);
  const dayPart = parts[0] || "";
  const timePart = parts.slice(1).join(", ");

  let days = "";
  for (const [re, code] of DAY_MAP) {
    if (re.test(dayPart)) days += code;
  }

  let start = "";
  let end = "";
  const tm = timePart.match(/(\d{1,2}:\d{2}\s*[ap]m)\s+to\s+(\d{1,2}:\d{2}\s*[ap]m)/i);
  if (tm) {
    start = tm[1].trim();
    end = tm[2].trim();
  }
  return { days, start, end };
}

function classifyMode(modeRaw: string): string {
  const m = modeRaw.toLowerCase();
  if (m.includes("fully online") || m.includes("online")) {
    if (m.includes("partially")) return "hybrid";
    return "online";
  }
  if (m.includes("hybrid") || m.includes("partially")) return "hybrid";
  if (m.includes("person") || m.includes("f2f") || m.includes("face")) return "in-person";
  if (!m.trim()) return "tba";
  return "in-person";
}

function parseSeats(raw: string): number | null {
  // "18 open seats" / "13 waitlist places available" / "Closed"
  const m = raw.match(/(\d+)\s+open/);
  if (m) return parseInt(m[1], 10);
  if (/waitlist/i.test(raw)) return 0;
  if (/closed/i.test(raw)) return 0;
  return null;
}

interface ParsedCard {
  section: CourseSection;
  collegeCode: string; // ARC/CRC/SCC/FLC
  courseId: string;    // for modal cache
  classSection: string;
}

function parseCard($: cheerio.CheerioAPI, article: cheerio.AnyNode, term: TermSpec): ParsedCard | null {
  const $a = $(article);

  // Subject + number + title
  const subjNum = $a.find(".class-card-subj-num").first().text().trim();
  const titleNode = $a.find(".title").first();
  // The title node text is "ACCT 101 Fundamentals…"; strip the subj-num span.
  const fullTitle = titleNode.text().replace(/\s+/g, " ").trim();
  const courseTitle = fullTitle.replace(subjNum, "").trim();

  const sm = subjNum.match(/^([A-Z]+)\s+(\S+)$/);
  if (!sm) return null;
  const prefix = sm[1];
  const number = sm[2];

  // Units → credits
  let credits: number | null = null;
  const unitsText = $a.find(".units").text().trim();
  const um = unitsText.match(/(\d+(?:\.\d+)?)/);
  if (um) credits = parseFloat(um[1]);

  // Location
  const college = $a.find(".college").first().text().trim();
  const campus = $a.find(".campus").first().text().trim();

  // Session → start_date
  const sessionRaw = $a.find(".session").first().text().replace(/\s+/g, " ").trim();
  const start_date = parseSessionStartDate(sessionRaw, term.year);

  // Detail row
  const detailUl = $a.find(".details ul").first();
  const liTexts: Record<string, string> = {};
  detailUl.find("li").each((_, li) => {
    const $li = $(li);
    const label = $li.find(".label").first().text().replace(/:$/, "").trim().toLowerCase();
    const value = $li.clone().find(".label").remove().end().text().replace(/\s+/g, " ").trim();
    if (label) liTexts[label] = value;
    if ($li.hasClass("section")) liTexts["section_raw"] = $li.text().replace(/\s+/g, " ").trim();
    if ($li.hasClass("status")) liTexts["status_raw"] = $li.text().replace(/\s+/g, " ").trim();
  });

  // CRN: from "Class LEC 11310" or just the section li's number
  let crn = "";
  const sectionRaw = liTexts["section_raw"] || "";
  const cm = sectionRaw.match(/(\d{4,6})/);
  if (cm) crn = cm[1];

  // Day/Time
  const dayTime = liTexts["day/time"] || "";
  const { days, start, end } = parseDaysAndTime(dayTime);

  // Mode
  const mode = classifyMode(liTexts["mode"] || "");

  // Building/location string
  const location = liTexts["building"] || (mode === "online" ? "ONLINE" : "");

  // Instructor
  const instructor = liTexts["instructor"] || null;

  // Seats
  const seats_open = parseSeats(liTexts["status_raw"] || "");

  // College code from getModal href
  const modalHref = $a.find(".more-info").attr("onclick") || "";
  // getModal('000468','201','ARC','1269|11310');
  const mm = modalHref.match(/getModal\('([^']*)','([^']*)','([^']*)','([^']*)'\)/);
  let collegeCode = "";
  let courseId = "";
  let classSection = "";
  if (mm) {
    courseId = mm[1];
    classSection = mm[2];
    collegeCode = mm[3];
  }

  const slug = SLUG_BY_CODE[collegeCode] || "";
  if (!slug) return null;

  return {
    section: {
      college_code: slug,
      term: term.fileTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: courseTitle,
      credits,
      crn,
      days,
      start_time: start,
      end_time: end,
      start_date,
      location,
      campus: campus || college,
      mode,
      instructor,
      seats_open,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    },
    collegeCode,
    courseId,
    classSection,
  };
}

// ---------------------------------------------------------------------------
// Modal parsing (per-course prereq cache)
// ---------------------------------------------------------------------------

function parseModal(html: string): CourseDetail {
  const $ = cheerio.load(html);
  let prerequisite_text: string | null = null;
  $("li").each((_, li) => {
    const label = $(li).find(".label").first().text().replace(/:$/, "").trim().toLowerCase();
    if (label === "prerequisite" || label === "prerequisites") {
      const v = $(li).clone().find(".label").remove().end().text().replace(/\s+/g, " ").trim();
      if (v) prerequisite_text = v;
    }
  });

  const prerequisite_courses: string[] = [];
  if (prerequisite_text) {
    // Los Rios uses bare codes like "ENGWR 300", "MATH 120". Extract them.
    // Avoid mistakenly picking up the section's own prefix in advisory clauses
    // like "completion of (DEPT NNN with grade C or higher)".
    const re = /\b([A-Z]{2,6})\s+(\d{2,3}[A-Z]?)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prerequisite_text)) !== null) {
      const code = `${m[1]} ${m[2]}`;
      if (!prerequisite_courses.includes(code)) prerequisite_courses.push(code);
    }
  }

  return { prerequisite_text, prerequisite_courses };
}

async function fetchModal(
  college: string,
  courseId: string,
  classSection: string,
  strm: string,
  referer: string,
): Promise<CourseDetail> {
  const url = `${BASE}/getModal.php?ClassSection=${encodeURIComponent(
    classSection,
  )}&CourseId=${encodeURIComponent(courseId)}&college=${encodeURIComponent(
    college,
  )}&modalStrm=${encodeURIComponent(strm)}`;
  try {
    const html = await fetchHtml(url, referer);
    return parseModal(html);
  } catch {
    return { prerequisite_text: null, prerequisite_courses: [] };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeCollegeTerm(
  college: CollegeSpec,
  term: TermSpec,
  subjects: string[],
  checkpoint?: (sections: CourseSection[]) => void,
  seedSections: CourseSection[] = [],
): Promise<CourseSection[]> {
  const referer = `https://${college.hostPrefix}.losrios.edu/`;
  const sections: CourseSection[] = [...seedSections];
  const modalCache = new Map<string, CourseDetail>();

  for (let i = 0; i < subjects.length; i++) {
    const subj = subjects[i];
    const url = buildListingUrl(college, term, subj);
    let html = "";
    try {
      html = await fetchHtml(url, referer);
    } catch (err) {
      console.warn(`  ${college.code} ${term.name} ${subj}: ${(err as Error).message}`);
      continue;
    }
    const $ = cheerio.load(html);
    const cards = $("article.class-card").toArray();
    if (cards.length === 0) {
      await sleep(120);
      continue;
    }

    let added = 0;
    for (const card of cards) {
      const parsed = parseCard($, card, term);
      if (!parsed) continue;
      if (parsed.collegeCode !== college.code) continue; // safety: only this college

      // Enrich with cached modal (prereqs)
      const cacheKey = `${parsed.collegeCode}|${parsed.courseId}`;
      let detail = modalCache.get(cacheKey);
      if (!detail) {
        detail = await fetchModal(
          parsed.collegeCode,
          parsed.courseId,
          parsed.classSection,
          term.strm,
          referer,
        );
        modalCache.set(cacheKey, detail);
        await sleep(150);
      }
      parsed.section.prerequisite_text = detail.prerequisite_text;
      parsed.section.prerequisite_courses = [...detail.prerequisite_courses];
      sections.push(parsed.section);
      added++;
    }
    if (added > 0 && (i % 20 === 0 || added >= 10)) {
      console.log(
        `  ${college.code} ${term.name}: ${subj} +${added} (${i + 1}/${subjects.length}, total=${sections.length})`,
      );
    }
    // Per-subject checkpoint: flush accumulated sections to disk so a crash
    // mid-term loses at most one subject's work, not the whole term. Only
    // flush when we actually added something (skip empty subjects).
    if (added > 0 && checkpoint) {
      checkpoint(sections);
    }
    await sleep(180);
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

  const termsToRun = termFilter
    ? TERMS.filter((t) => t.name === termFilter)
    : TERMS;
  if (termsToRun.length === 0) {
    console.error(`Unknown --term "${termFilter}". Valid: ${TERMS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }
  const collegesToRun = collegeFilter
    ? COLLEGES.filter((c) => c.code === collegeFilter)
    : COLLEGES;
  if (collegesToRun.length === 0) {
    console.error(`Unknown --college "${collegeFilter}". Valid: ARC, CRC, SCC, FLC`);
    process.exit(1);
  }

  // Pre-fetch subjects per term (CCD-wide; same for all 4 colleges)
  const subjectsByTerm = new Map<string, string[]>();
  for (const term of termsToRun) {
    const subs = await fetchSubjectsForTerm(
      term.strm,
      `https://${collegesToRun[0].hostPrefix}.losrios.edu/`,
    );
    subjectsByTerm.set(term.strm, subs);
    console.log(`Term ${term.name}: ${subs.length} subjects`);
  }

  // Scrape and write per (college, term) so a crash mid-run preserves
  // everything already completed. Resume: if {slug}/{fileTerm}.json already
  // exists, skip — re-run the command and it picks up where it left off.
  for (const college of collegesToRun) {
    for (const term of termsToRun) {
      const dir = path.join(DATA_DIR, college.slug);
      const out = path.join(dir, `${term.fileTerm}.json`);
      if (fs.existsSync(out)) {
        console.log(`\n=== ${college.code} — ${term.name} — SKIP (already exists: ${out})`);
        continue;
      }
      console.log(`\n=== ${college.code} (${college.slug}) — ${term.name} ===`);
      const subs = subjectsByTerm.get(term.strm) ?? [];
      fs.mkdirSync(dir, { recursive: true });
      // Partial-checkpoint path: receives writes after every subject so a
      // mid-term crash preserves work. Atomically renamed to `out` only on
      // successful term completion — so the resume check (fs.existsSync(out))
      // never treats a partial as complete. The .partial.json file lingers
      // after a crash and gets overwritten on the next run's first subject.
      const partial = path.join(dir, `${term.fileTerm}.partial.json`);

      // Mid-term resume: if a partial from a prior killed run exists, load
      // its sections and skip subjects already represented. Subject identity
      // is `course_prefix`. Saves having to re-scrape work already on disk.
      let seedSections: CourseSection[] = [];
      let subsToRun = subs;
      if (fs.existsSync(partial)) {
        try {
          seedSections = JSON.parse(fs.readFileSync(partial, "utf8"));
          const done = new Set(seedSections.map((s) => s.course_prefix));
          subsToRun = subs.filter((s) => !done.has(s));
          console.log(
            `  resume from partial: ${seedSections.length} sections, ${done.size} subjects done, ${subsToRun.length}/${subs.length} subjects remaining`,
          );
        } catch (err) {
          console.warn(`  partial unreadable (${(err as Error).message}); starting fresh`);
          seedSections = [];
          subsToRun = subs;
        }
      }

      const sections = await scrapeCollegeTerm(college, term, subsToRun, (snap) => {
        const tmp = `${partial}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(snap, null, 2) + "\n");
        fs.renameSync(tmp, partial);
      }, seedSections);
      console.log(`  total: ${sections.length} sections`);
      if (sections.length === 0) {
        console.log(`  skip empty ${college.slug}/${term.fileTerm}`);
        // Clean up any stale partial from a prior failed attempt.
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
        continue;
      }
      // Atomic finalize: rename partial → final. After this, the resume
      // check treats this (college, term) as complete.
      const tmp = `${out}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(sections, null, 2) + "\n");
      fs.renameSync(tmp, out);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
      console.log(`  wrote ${sections.length} → ${out}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
