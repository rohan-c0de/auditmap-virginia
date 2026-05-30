/**
 * Herkimer County Community College — Silverstripe CMS HTML schedule
 *
 * Schedule lives at /academics/course-schedule/{term}/ where term is
 * spring|summer|fall. The page renders a series of per-subject tables
 * with the structure:
 *
 *   <table class="subject-table responsive">
 *     <tr>...header...</tr>
 *     <tr class="odd|even">
 *       <td>BU104-01</td>           # course code + section
 *       <td>&nbsp;</td>              # spacer
 *       <td>40362</td>               # CRN
 *       <td>Financial Accounting</td>
 *       <td>4</td>                   # credits
 *       <td>MWF11:15 am - 12:10 pm</td>
 *       <td>Amy Getman</td>          # instructor
 *     </tr>
 *   </table>
 *
 * Individual section detail at /academics/course-schedule/{term}/course/{id}/{slug}/
 * could provide more (location, prereqs) but for now we extract from the
 * summary table only.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-herkimer.ts
 *   npx tsx scripts/ny/scrape-herkimer.ts --term fall
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "ny";
const SLUG = "herkimer-cc";
const BASE = "https://herkimer.edu";
const TERMS = ["spring", "summer", "fall"] as const;
type Term = (typeof TERMS)[number];

const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";
const REQUEST_DELAY_MS = 600;

interface Section {
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

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function parseDays(raw: string): { days: string; startTime: string; endTime: string } {
  // Examples: "MWF11:15 am - 12:10 pm", "TR6:00 pm - 9:00 pm", "ONLINE", "TBA"
  const text = raw.trim();
  if (!text || /tba|online|asynchronous/i.test(text)) {
    return { days: "", startTime: "", endTime: "" };
  }
  const m = /^([MTWRFSU]+)\s*(\d{1,2}:\d{2}\s*(?:am|pm))\s*-\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i.exec(text);
  if (!m) return { days: text, startTime: "", endTime: "" };
  const daysRaw = m[1];
  const daysExpanded = daysRaw
    .replace(/M/g, "Mo ").replace(/T(?!h)/g, "Tu ").replace(/W/g, "We ")
    .replace(/R/g, "Th ").replace(/F/g, "Fr ").replace(/S(?!u)/g, "Sa ").replace(/U/g, "Su ")
    .trim().split(/\s+/).join("");
  return { days: daysExpanded, startTime: m[2].toUpperCase(), endTime: m[3].toUpperCase() };
}

function termToCode(term: Term): string {
  const year = new Date().getFullYear();
  // Use academic year: spring/summer = current year, fall = current year
  if (term === "spring") return `${year}SP`;
  if (term === "summer") return `${year}SU`;
  return `${year}FA`;
}

function detectMode(daysRaw: string, instructor: string): string {
  const lower = daysRaw.toLowerCase();
  if (lower.includes("online") || lower.includes("async")) return "online";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("zoom") || lower.includes("remote")) return "zoom";
  return "in-person";
}

function parseCourseCode(raw: string): { prefix: string; number: string; section: string } {
  // BU104-01 or MA101A-02
  const m = /^([A-Z]+)(\d+[A-Z]*)-?(\d*)/.exec(raw.trim());
  if (!m) return { prefix: "", number: "", section: "" };
  return { prefix: m[1], number: m[2], section: m[3] || "" };
}

async function scrapeTerm(term: Term, termCode: string): Promise<Section[]> {
  const url = `${BASE}/academics/course-schedule/${term}/`;
  console.log(`  Fetching ${url}...`);
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const sections: Section[] = [];

  $("table.subject-table").each((_, table) => {
    const rows = $(table).find("tr.odd, tr.even");
    rows.each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 7) return;
      const courseRaw = $(cells[0]).text().trim();
      const crn = $(cells[2]).text().trim();
      const title = $(cells[3]).text().trim();
      const creditsRaw = $(cells[4]).text().trim();
      const daysRaw = $(cells[5]).text().trim();
      const instructor = $(cells[6]).text().trim() || null;

      const code = parseCourseCode(courseRaw);
      if (!code.prefix || !code.number) return;

      const { days, startTime, endTime } = parseDays(daysRaw);
      sections.push({
        college_code: SLUG,
        term: termCode,
        course_prefix: code.prefix,
        course_number: code.number,
        course_title: title,
        credits: parseFloat(creditsRaw) || 0,
        crn,
        days,
        start_time: startTime,
        end_time: endTime,
        start_date: "",
        location: "",
        campus: "Herkimer",
        mode: detectMode(daysRaw, instructor || ""),
        instructor,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    });
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--term");
  const termFilter = idx >= 0 ? (args[idx + 1] as Term) : null;
  const terms = termFilter ? [termFilter] : TERMS;

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  for (const term of terms) {
    try {
      const termCode = termToCode(term);
      const sections = await scrapeTerm(term, termCode);
      if (sections.length === 0) {
        console.log(`  ${term}: 0 sections (term may be inactive)`);
        continue;
      }
      const outFile = path.join(outDir, `${termCode}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
      console.log(`  ${term}: ${sections.length} sections → ${termCode}.json`);
      grandTotal += sections.length;
      await sleep(REQUEST_DELAY_MS);
    } catch (e) {
      console.error(`  ${term}: ERROR ${(e as Error).message}`);
    }
  }

  console.log(`\nHerkimer: ${grandTotal} total sections written`);
}

main().catch((e) => { console.error(e); process.exit(1); });
