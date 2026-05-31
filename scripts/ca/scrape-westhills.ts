/**
 * scrape-westhills.ts — West Hills Community College District
 *
 * West Hills CCD (Coalinga College + Lemoore College) publishes its full
 * schedule on a single HTML table at classweb.westhillscollege.com/schedule/.
 * One GET returns every section across both colleges and all active terms.
 * The "College" column distinguishes Coalinga from Lemoore; section codes
 * ending in -C## are Coalinga, -L## are Lemoore.
 *
 * The table has: College, Subject, (Section) Title, Location, Term, Starts,
 * Length, Status. The tooltip on the info icon has add/drop/W dates.
 *
 * Output: data/ca/courses/{coalinga-college,lemoore-college}/{2026SP|SU|FA}.json
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const URL = "https://classweb.westhillscollege.com/schedule/";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const CAMPUS_TO_SLUG: Record<string, string> = {
  Coalinga: "coalinga-college",
  Lemoore:  "lemoore-college",
};

const TERM_MAP: Record<string, string> = {
  "2026/SP": "2026SP",
  "2026/SU": "2026SU",
  "2026/FA": "2026FA",
};

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

function deriveMode(location: string): CourseSection["mode"] {
  const loc = location.toLowerCase();
  if (loc.includes("online")) return "online";
  if (loc.includes("hybrid")) return "hybrid";
  if (loc && !loc.includes("tba") && !loc.includes("tbd")) return "in-person";
  return "unknown";
}

function parseStartDate(raw: string): string {
  // "06/15/2026" → "2026-06-15"
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

async function main() {
  console.log("Fetching West Hills CCD schedule...");
  const res = await fetch(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`  fetched ${(html.length / 1024).toFixed(0)} KB`);

  const $ = cheerio.load(html);
  const rows = $("#ActiveSectionsTable tbody tr");
  console.log(`  found ${rows.length} table rows`);

  // Bucket: slug → fileTerm → CourseSection[]
  const buckets = new Map<string, Map<string, CourseSection[]>>();

  rows.each((_, tr) => {
    const tds = $(tr).children("td").toArray();
    if (tds.length < 8) return;

    const college = $(tds[0]).text().trim();
    const subject = $(tds[1]).text().trim();
    const sectionCell = $(tds[2]);
    const location = $(tds[3]).text().trim();
    const termRaw = $(tds[4]).text().trim();
    const starts = $(tds[5]).text().trim();
    const status = $(tds[7]).text().trim();

    const slug = CAMPUS_TO_SLUG[college];
    if (!slug) return;

    const fileTerm = TERM_MAP[termRaw];
    if (!fileTerm) return;

    // Parse "(CD-004-L50) Parenting" from the link
    const linkText = sectionCell.find("a").first().text().trim();
    const m = linkText.match(/^\(([A-Z]+)-([A-Z0-9]+)-([A-Z]\d+)\)\s+(.+)$/);
    if (!m) return;

    const prefix = m[1];
    const number = m[2];
    const sectionCode = m[3];
    const title = m[4].trim();

    // Extract section ID from href for CRN
    const href = sectionCell.find("a").first().attr("href") ?? "";
    const idMatch = href.match(/sectionids\/(\d+)/);
    const crn = idMatch ? idMatch[1] : sectionCode;

    // Waitlist info from status title attribute
    const statusTitle = $(tds[7]).attr("title") ?? "";
    let seatsOpen: number | null = null;
    if (/open/i.test(status)) {
      const sm = statusTitle.match(/Available\s*(?:Seats)?:\s*(\d+)/i);
      seatsOpen = sm ? parseInt(sm[1], 10) : null;
    } else if (/full|closed|waitlist/i.test(status)) {
      seatsOpen = 0;
    }

    const section: CourseSection = {
      college_code: slug,
      term: fileTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: null,
      crn,
      days: "",
      start_time: "",
      end_time: "",
      start_date: parseStartDate(starts),
      location,
      campus: `${college} College`,
      mode: deriveMode(location),
      instructor: "",
      seats_open: seatsOpen,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    };

    let perCollege = buckets.get(slug);
    if (!perCollege) {
      perCollege = new Map();
      buckets.set(slug, perCollege);
    }
    const list = perCollege.get(fileTerm) ?? [];
    list.push(section);
    perCollege.set(fileTerm, list);
  });

  // Write files
  for (const [slug, perTerm] of buckets.entries()) {
    const dir = path.join(DATA_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    for (const [fileTerm, sections] of perTerm.entries()) {
      // Dedup by CRN
      const seen = new Set<string>();
      const deduped = sections.filter((s) => {
        if (seen.has(s.crn)) return false;
        seen.add(s.crn);
        return true;
      });
      const out = path.join(dir, `${fileTerm}.json`);
      fs.writeFileSync(out, JSON.stringify(deduped, null, 2) + "\n");
      const removed = sections.length - deduped.length;
      console.log(
        `  ${slug}/${fileTerm}: ${deduped.length} sections${removed > 0 ? ` (-${removed} dupes)` : ""}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
