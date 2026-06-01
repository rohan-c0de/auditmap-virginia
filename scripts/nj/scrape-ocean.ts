/**
 * Ocean County College — bespoke PHP schedule scraper.
 *
 * OCC's old Ellucian Colleague Self-Service at selfservice.ocean.edu is dead.
 * Its public class schedule is now a custom PHP app that server-renders all
 * sections into the HTML (no login, no JS):
 *
 *   GET https://media.ocean.edu/Schedule/schedule.php?term=2026FA
 *       → one <div class="course"> per course, each holding the course header
 *         (course_name / course_title / course_cred), a label row, then one
 *         section group per offered section (course_sec / course_type /
 *         course_prof / course_loc / course_days / course_start / course_end /
 *         course_cost / course_capacity).
 *
 * Term codes appear in <select id="sel_term">. Only standard YYYY{FA,SP,SU}
 * codes are scraped — OCC also exposes non-standard summer/sub-session codes
 * (2026L3, 2026S10, 2026SF5, …) that the project's term model doesn't use.
 *
 * Usage:
 *   npx tsx scripts/nj/scrape-ocean.ts                 # current standard terms
 *   npx tsx scripts/nj/scrape-ocean.ts --term 2026FA   # single term
 *   npx tsx scripts/nj/scrape-ocean.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "ocean";
const STATE = "nj";
const BASE = "https://media.ocean.edu/Schedule/schedule.php";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: never[];
}

const DAY_MAP: Record<string, string> = {
  monday: "M",
  tuesday: "T",
  wednesday: "W",
  thursday: "R",
  friday: "F",
  saturday: "S",
  sunday: "U",
};

function parseDays(raw: string): string {
  // OCC concatenates day names without separators: "MondayWednesday" → "MW",
  // "TuesdayThursday" → "TR". "On-Line"/"TBA" → "".
  const out: string[] = [];
  const re = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw.toLowerCase())) !== null) out.push(DAY_MAP[m[1]]);
  return out.join("");
}

function to24(raw: string): string {
  // The cell may concatenate repeated times for multi-day meetings
  // ("9:30 AM9:30 AM"); take the first time token.
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function parseCapacity(raw: string): { open: number | null; total: number | null } {
  // "26/30 - 4 seat(s) available" → total 30, open 4
  const total = raw.match(/\/(\d+)/)?.[1];
  const open = raw.match(/(\d+)\s+seat/i)?.[1];
  return {
    total: total ? parseInt(total, 10) : null,
    open: open ? parseInt(open, 10) : null,
  };
}

function parseCourseCode(raw: string): { prefix: string; number: string } | null {
  // "ACCT-161" → ACCT, 161
  const m = raw.trim().match(/^([A-Z]{2,5})-?\s*(\w+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

async function loadTermOptions(): Promise<string[]> {
  const res = await fetch(`${BASE}?term=2026FA`, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const terms: string[] = [];
  $("#sel_term option, select[name='sel_term'] option").each((_, el) => {
    const v = ($(el).attr("value") || "").trim();
    if (/^\d{4}(FA|SP|SU)$/.test(v)) terms.push(v);
  });
  return terms.length ? terms : ["2026FA"];
}

async function scrapeTerm(term: string): Promise<CourseSection[]> {
  const res = await fetch(`${BASE}?term=${term}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${term}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $("div.course").each((_, courseEl) => {
    const $c = $(courseEl);
    const code = parseCourseCode($c.find(".course_name").first().text());
    if (!code) return;
    const title = $c.find(".course_title").first().text().trim();
    const credits = parseFloat($c.find(".course_cred").first().text().replace(/[^\d.]/g, "")) || 0;

    // Walk the flat field list; each section starts at a course_sec whose value
    // is not the "Sec" header label.
    const fields = $c
      .find("[class^='course_']")
      .toArray()
      .map((el) => ({ cls: ($(el).attr("class") || "").trim(), val: $(el).text().trim() }));

    let cur: Record<string, string> | null = null;
    const flush = () => {
      if (!cur || !cur.course_sec || cur.course_sec === "Sec") return;
      const days = parseDays(cur.course_days || "");
      const loc = cur.course_loc || "";
      const online = /on-?line/i.test(loc) || /on-?line/i.test(cur.course_days || "");
      const { open, total } = parseCapacity(cur.course_capacity || "");
      sections.push({
        college_code: SLUG,
        term,
        course_prefix: code.prefix,
        course_number: code.number,
        course_title: title,
        credits,
        crn: `${code.prefix}-${code.number}-${cur.course_sec}`,
        days,
        start_time: online ? "" : to24(cur.course_start || ""),
        end_time: online ? "" : to24(cur.course_end || ""),
        start_date: "",
        location: online ? "Online" : loc,
        campus: "Ocean County College",
        mode: online ? "online" : "in-person",
        instructor: cur.course_prof && cur.course_prof !== "Professor" ? cur.course_prof : null,
        seats_open: open,
        seats_total: total,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    };

    for (const f of fields) {
      if (f.cls === "course_sec") {
        // Start of a new section group (or the header label).
        flush();
        cur = {};
      }
      if (cur) cur[f.cls] = f.val;
    }
    flush();
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const single = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("Ocean County College — PHP schedule scraper");
  console.log(`   Source: ${BASE}`);
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const terms = single ? [single] : await loadTermOptions();
  console.log(`   Scraping ${terms.length} term(s): ${terms.join(", ")}`);

  let grandTotal = 0;
  for (const term of terms) {
    process.stdout.write(`  ${term}... `);
    let sections: CourseSection[] = [];
    try {
      sections = await scrapeTerm(term);
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
      continue;
    }
    if (sections.length === 0) {
      console.log("0 sections (skipping)");
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n${SLUG}: ${grandTotal} total sections`);
  if (args.includes("--no-import")) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("Ocean scraper failed:", err);
  process.exit(1);
});
