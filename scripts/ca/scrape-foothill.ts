/**
 * scrape-foothill.ts — Foothill College class schedule scraper
 *
 * Foothill College (one of two Foothill-De Anza CCD colleges) exposes a
 * public, unauthenticated class search at https://foothill.edu/schedule/.
 * The same host serves all results inline for a given (Quarter, dept) pair:
 *
 *   GET foothill.edu/schedule/index.html?Quarter=2026F&dept=MATH|Mathematics
 *
 * Term codes (Quarter param):
 *   2026S = Spring 2026   2026M = Summer 2026   2026F = Fall 2026
 *
 * HTML structure per course:
 *   .fh_sched-course   → course header (id via .fh_course-id, title, units)
 *   .fh_course-meta    → sibling: transfer status
 *   .panel-group       → sibling: accordion with description + prereqs
 *   .fh_sched-wrap     → sibling (one per section): wraps .section
 *     .section
 *       .fh_section-head  → section id, CRN, dates, availability
 *       tbody tr          → Type, Room, Day & Time, Instructor, Modality
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-foothill.ts
 *   npx tsx scripts/ca/scrape-foothill.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-foothill.ts --term "Fall 2026" --dept MATH
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const BASE = "https://foothill.edu/schedule/index.html";
const COLLEGE_SLUG = "foothill-college";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses", COLLEGE_SLUG);

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://foothill.edu/schedule/",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

interface TermSpec {
  name: string;
  code: string;      // Quarter param value e.g. "2026F"
  fileTerm: string;  // output filename stem e.g. "2026FA"
}

const TERMS: TermSpec[] = [
  { name: "Spring 2026", code: "2026S", fileTerm: "2026SP" },
  { name: "Summer 2026", code: "2026M", fileTerm: "2026SU" },
  { name: "Fall 2026",   code: "2026F", fileTerm: "2026FA" },
];

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  section_id: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseDayTime(raw: string): { days: string; start_time: string; end_time: string } {
  if (!raw || raw.trim() === "TBA" || raw.trim() === "") {
    return { days: "TBA", start_time: "TBA", end_time: "TBA" };
  }
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d+:\d+\s*[AP]M)\s*-\s*(\d+:\d+\s*[AP]M)$/i);
  if (m) {
    return { days: m[1].toUpperCase(), start_time: m[2].trim(), end_time: m[3].trim() };
  }
  if (/online|tba|to be/i.test(raw)) {
    return { days: "TBA", start_time: "TBA", end_time: "TBA" };
  }
  return { days: raw.trim(), start_time: "TBA", end_time: "TBA" };
}

function parsePrereqs(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.toLowerCase() === "none") return [];
  const matches = cleaned.match(/[A-Z][A-Z\s&]*\d+[A-Z]*/g) ?? [];
  return [...new Set(matches.map((m) => m.trim()))];
}

async function fetchDepts(termCode: string): Promise<Array<{ code: string; title: string }>> {
  const html = await fetchHtml(`${BASE}?Quarter=${termCode}`);
  const $ = cheerio.load(html);
  const depts: Array<{ code: string; title: string }> = [];
  $("select[name='dept'] option").each((_, el) => {
    const val = $(el).val() as string;
    if (!val || val === "every") return;
    const [code, title] = val.split("|");
    if (code && code.trim()) depts.push({ code: code.trim(), title: (title ?? code).trim() });
  });
  return depts;
}

async function scrapeDeptTerm(
  dept: { code: string; title: string },
  term: TermSpec,
): Promise<CourseSection[]> {
  const url = `${BASE}?Quarter=${term.code}&dept=${encodeURIComponent(dept.code + "|" + dept.title)}`;
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    console.warn(`  WARN ${dept.code} ${term.name}: ${(err as Error).message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $(".fh_sched-course").each((_, courseEl) => {
    const rawId = $(courseEl).find(".fh_course-id").text().trim();
    const title = $(courseEl).find(".fh_course-head").text()
      .replace(/HONORS\s*/i, "").replace(/\s+/g, " ").trim();
    const unitsText = $(courseEl).find(".fh_course-units").text().trim();
    const credits = parseFloat(unitsText) || null;
    const idParts = rawId.split(/\s+/);
    const prefix = idParts[0] ?? dept.code;
    const number = idParts.slice(1).join("") ?? "";

    // Prereqs live in the hidden accordion panel keyed by course id
    const accordionId = rawId.replace(/\s+/g, "-");
    let prereq_text: string | null = null;
    $(`#fh_accordion-${accordionId} .fh_detail-label`).each((_, labelEl) => {
      if (/^Prerequisite:?$/i.test($(labelEl).text().trim())) {
        const text = $(labelEl).parent("li").text()
          .replace(/Prerequisite:?\s*/i, "").replace(/\s+/g, " ").trim();
        if (text) prereq_text = text;
      }
    });

    // Walk siblings: .fh_sched-wrap each contain one .section
    let sibling = $(courseEl).next();
    while (sibling.length && !sibling.hasClass("fh_sched-course")) {
      if (sibling.hasClass("fh_sched-wrap")) {
        const sectionEl = sibling.find(".section");
        const head = sectionEl.find(".fh_section-head");

        const fhSessids = head.find(".fh_sessid-dates");
        const sectionIdRaw = fhSessids.eq(0).find("p").text().trim();
        const crn = fhSessids.filter((_, d) =>
          $(d).find("h5").text().includes("CRN")).find("p").text().trim();
        const datesText = fhSessids.filter((_, d) =>
          $(d).find("h5").text().includes("Date")).find("p").text().trim();

        let start_date = "";
        let end_date = "";
        const dateMatch = datesText.match(/(\d+\/\d+\/\d+)\s*-\s*(\d+\/\d+\/\d+)/);
        if (dateMatch) { start_date = dateMatch[1]; end_date = dateMatch[2]; }

        const seatsText = head.find(".meet-availability p").text().trim();
        const seatsMatch = seatsText.match(/(\d+) of (\d+) seats open/);
        const seats_open = seatsMatch ? parseInt(seatsMatch[1], 10) : null;
        const seats_total = seatsMatch ? parseInt(seatsMatch[2], 10) : null;

        if (crn) {
          sectionEl.find("tbody tr").each((_, row) => {
            const cell = (label: string) =>
              $(row).find(`td[data-label="${label}"]`).text().trim();

            const { days, start_time, end_time } = parseDayTime(cell("Day & Time"));

            sections.push({
              college_code: "FH",
              term: term.name,
              course_prefix: prefix || dept.code,
              course_number: number,
              course_title: title,
              credits,
              crn,
              section_id: sectionIdRaw,
              days,
              start_time,
              end_time,
              start_date,
              end_date,
              location: cell("Room") || "TBA",
              mode: cell("Modality") || cell("Type") || "Unknown",
              instructor: cell("Instructor") || null,
              seats_open,
              seats_total,
              prerequisite_text: prereq_text,
              prerequisite_courses: parsePrereqs(prereq_text ?? ""),
            });
          });
        }
      }
      sibling = sibling.next();
    }
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
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

  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const term of termsToRun) {
    const out = path.join(DATA_DIR, `${term.fileTerm}.json`);
    if (fs.existsSync(out) && !deptFilter) {
      console.log(`\n=== ${term.name} — SKIP (${out} exists) ===`);
      continue;
    }
    const partial = path.join(DATA_DIR, `${term.fileTerm}.partial.json`);

    console.log(`\nFetching dept list for ${term.name}…`);
    let depts = await fetchDepts(term.code);
    if (deptFilter) depts = depts.filter((d) => d.code === deptFilter);
    console.log(`  ${depts.length} depts`);

    // Resume: load partial if exists, skip already-scraped prefixes
    let allSections: CourseSection[] = [];
    let deptsToRun = depts;
    if (fs.existsSync(partial) && !deptFilter) {
      try {
        allSections = JSON.parse(fs.readFileSync(partial, "utf8"));
        const done = new Set(allSections.map((s) => s.course_prefix));
        deptsToRun = depts.filter((d) => !done.has(d.code));
        console.log(
          `  resume from partial: ${allSections.length} sections, ${done.size} depts done, ${deptsToRun.length}/${depts.length} remaining`,
        );
      } catch {
        allSections = [];
        deptsToRun = depts;
      }
    }

    for (let i = 0; i < deptsToRun.length; i++) {
      const dept = deptsToRun[i];
      const fetched = await scrapeDeptTerm(dept, term);
      allSections.push(...fetched);
      if (fetched.length > 0) {
        console.log(
          `  [${term.name}] ${dept.code} (${i + 1}/${deptsToRun.length}) → ${fetched.length} sections (total: ${allSections.length})`,
        );
        const tmp = `${partial}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(allSections, null, 2) + "\n");
        fs.renameSync(tmp, partial);
      }
      await sleep(300);
    }

    if (allSections.length === 0) {
      console.log(`  no sections for ${term.name}; skipping write`);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
      continue;
    }

    const tmp = `${out}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(allSections, null, 2) + "\n");
    fs.renameSync(tmp, out);
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
    console.log(`  wrote ${allSections.length} sections → ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
