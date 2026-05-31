/**
 * Flathead Valley Community College — bespoke ASP schedule scraper
 *
 * FVCC (Kalispell, MT) publishes its course schedule as a set of static ASP
 * pages at https://elements.fvcc.edu/Schedules/, one directory per term
 * (fa26/, su26/, sp26/, etc.) with campus sub-pages inside each directory:
 *   mcc.asp  — Kalispell Campus (main campus, in-person)
 *   lcc.asp  — Lincoln County Campuses (Libby/Troy, in-person)
 *   cam.asp  — Online Courses
 *
 * Each campus page is a plain HTML table — no JavaScript required.
 * The row format (8 columns):
 *   col0: section_code  e.g. "ACTG_201_01"
 *   col1: course title + "Meets: {startDate}-{endDate}" + campus note
 *   col2: credits       e.g. "4cr"
 *   col3: days          e.g. "TTh"
 *   col4: time range    e.g. "9:00AM-10:50AM"
 *   col5: room          e.g. "BSS 137"
 *   col6: seats avail   e.g. "10"
 *   col7: instructor    e.g. "V Laudati"
 *
 * Term discovery: the top-level /Schedules/index.asp lists every published
 * term (links like "fa25/aaa.asp"). We filter to terms whose year-code is
 * >= the current year (i.e., fa26, su26, sp26, sp27) and scrape those.
 *
 * Discovered via the 2026-05-30 fingerprint re-baseline (#456 follow-up):
 * the fingerprinter never probed `elements.<domain>` — the schedule system
 * runs on a separate subdomain from the main college site.
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-fvcc.ts
 *   npx tsx scripts/mt/scrape-fvcc.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const SCHEDULE_BASE = "https://elements.fvcc.edu/Schedules";
const STATE = "mt";
const SLUG = "flathead-valley-community-college";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.status === 404) return "";
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === 2) throw e;
      await sleep(1000 * (i + 1));
    }
  }
  return "";
}

/** "ACTG_201_01" → {prefix:"ACTG", number:"201", section:"01"} */
function parseCode(raw: string): { prefix: string; number: string; section: string } | null {
  const parts = raw.trim().split("_");
  if (parts.length < 3) return null;
  const prefix = parts[0].toUpperCase();
  const section = parts[parts.length - 1].toUpperCase();
  const number = parts.slice(1, -1).join("_").toUpperCase();
  if (!/^[A-Z][A-Z0-9]*$/.test(prefix)) return null;
  return { prefix, number, section };
}

/** "3cr" → 3, "1.5cr" → 1.5, "TBD" → 0 */
function parseCredits(raw: string): number {
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/** "9:00AM-10:50AM" → {start:"9:00AM", end:"10:50AM"} */
function parseTime(raw: string): { start: string; end: string } {
  const m = raw.trim().match(/^(\d+:\d+[AP]M)\s*-\s*(\d+:\d+[AP]M)$/i);
  if (m) return { start: m[1], end: m[2] };
  return { start: raw.trim(), end: "" };
}

/** Extract start date from col1 text: "...Meets: 8/24/2026-..." → "2026-08-24" */
function parseStartDate(col1: string): string {
  const m = col1.match(/Meets:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Strip course title from col1 (everything before "Meets:" or end). */
function parseTitle(col1: string): string {
  const meetIdx = col1.indexOf("Meets:");
  const raw = meetIdx >= 0 ? col1.slice(0, meetIdx) : col1;
  return raw.trim();
}

/** "fa26" → {standard:"2026FA", year:2026, season:"FA"} */
function termCodeToStandard(code: string): string | null {
  const m = code.match(/^(fa|su|sp)(\d{2})$/i);
  if (!m) return null;
  const yr = 2000 + parseInt(m[2]);
  const s = m[1].toLowerCase();
  if (s === "fa") return `${yr}FA`;
  if (s === "su") return `${yr}SU`;
  if (s === "sp") return `${yr}SP`;
  return null;
}

async function scrapeTermCampus(
  termCode: string,
  standardTerm: string,
  campusFile: string,
  campusName: string,
  mode: "in-person" | "online"
): Promise<CourseSection[]> {
  const url = `${SCHEDULE_BASE}/${termCode}/${campusFile}`;
  const html = await get(url);
  if (!html) return [];
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $("table tr").each((_i, row) => {
    const cells: string[] = [];
    $(row)
      .find("td")
      .each((_j, c) => { cells.push($(c).text().trim().replace(/\s+/g, " ")); });
    if (cells.length < 7) return;
    const parsed = parseCode(cells[0]);
    if (!parsed) return; // header or non-section row

    const { start, end } = parseTime(cells[4] ?? "");
    const credits = parseCredits(cells[2] ?? "");

    sections.push({
      college_code: SLUG,
      term: standardTerm,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: parseTitle(cells[1] ?? ""),
      credits,
      crn: cells[0].trim(), // section_code serves as CRN (unique within term)
      days: cells[3]?.trim() ?? "",
      start_time: start,
      end_time: end,
      start_date: parseStartDate(cells[1] ?? ""),
      location: cells[5]?.trim() ?? "",
      campus: campusName,
      mode,
      instructor: cells[7]?.trim() || null,
      seats_open: cells[6] ? parseInt(cells[6]) || null : null,
      seats_total: null, // not published on these pages
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log(`\nScraping ${SLUG}…`);

  // Step 1: Discover available terms by probing candidate term dirs directly.
  // The top-level index.asp only lists PAST terms; upcoming terms are published
  // in their own directories before they appear on the index. Probe fa/su/sp
  // for the current year and next year.
  const now = new Date();
  const yr2 = now.getFullYear() % 100; // e.g. 26
  const candidates = [
    `sp${yr2}`, `su${yr2}`, `fa${yr2}`,
    `sp${yr2 + 1}`, `su${yr2 + 1}`, `fa${yr2 + 1}`,
  ];

  const termCodes: string[] = [];
  for (const code of candidates) {
    const probe = await get(`${SCHEDULE_BASE}/${code}/mcc.asp`);
    if (probe && probe.length > 500) termCodes.push(code); // has real content
    await sleep(200);
  }

  // Sort: sp < su < fa within same year
  const seasonOrder = (c: string) =>
    c.startsWith("sp") ? 0 : c.startsWith("su") ? 1 : 2;
  const terms = [...termCodes].sort((a, b) => {
    const ya = parseInt(a.slice(2)), yb = parseInt(b.slice(2));
    return ya !== yb ? ya - yb : seasonOrder(a) - seasonOrder(b);
  });

  console.log(`  Terms: ${terms.join(", ")}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const CAMPUS_PAGES: Array<{ file: string; name: string; mode: "in-person" | "online" }> = [
    { file: "mcc.asp", name: "Kalispell Campus", mode: "in-person" },
    { file: "lcc.asp", name: "Lincoln County Campus", mode: "in-person" },
    { file: "cam.asp", name: "Online", mode: "online" },
  ];

  let grandTotal = 0;

  for (const termCode of terms) {
    const standardTerm = termCodeToStandard(termCode);
    if (!standardTerm) continue;

    const seen = new Set<string>(); // dedupe by CRN across campus pages
    const allSections: CourseSection[] = [];

    for (const campus of CAMPUS_PAGES) {
      const sections = await scrapeTermCampus(
        termCode, standardTerm, campus.file, campus.name, campus.mode
      );
      for (const s of sections) {
        if (seen.has(s.crn)) continue;
        seen.add(s.crn);
        allSections.push(s);
      }
      await sleep(300);
    }

    if (allSections.length === 0) {
      console.log(`  ${standardTerm}: no sections`);
      continue;
    }

    allSections.sort((a, b) =>
      a.course_prefix.localeCompare(b.course_prefix) ||
      a.course_number.localeCompare(b.course_number)
    );

    const outFile = path.join(OUT_DIR, `${standardTerm}.json`);
    fs.writeFileSync(outFile, JSON.stringify(allSections, null, 2));
    console.log(`  ${standardTerm}: ${allSections.length} sections → ${standardTerm}.json`);
    grandTotal += allSections.length;
    await sleep(400);
  }

  console.log(`\n✓ ${SLUG}: ${grandTotal} total sections`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error("❌ FVCC scraper failed:", e);
  process.exit(1);
});
