/**
 * Mississippi Gulf Coast Community College — bespoke PHP schedule scraper.
 *
 * MGCCC publishes its public schedule as plain server-rendered HTML at
 * mgccc.edu/website_schedules/index.php with two query params:
 *
 *   ?term=fa | sp | su | maymester | merrymester
 *   &camp=ol | pk | hc | jc | gc | gp | traditions | ks
 *
 * The year is implicit (page H1 — "Fall 2026") and read off the rendered
 * heading; we derive the canonical term key (`2026FA`) from it.
 *
 * Each row's cells carry `data-label="<column>"` attributes (the page uses
 * them for responsive CSS), which makes parsing robust against column
 * reordering: CRN, SUB, CRSE, SEC, CRED, TITLE, FORMAT, P/T, DATES, MEET,
 * TIME, INSTR, SEATS, WAIT, BLDG, RM.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-mgccc.ts
 *   npx tsx scripts/ms/scrape-mgccc.ts --term fa
 *   npx tsx scripts/ms/scrape-mgccc.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "ms";
const SLUG = "mississippi-gulf-coast-community-college";
const BASE = "https://mgccc.edu/website_schedules/index.php";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TERMS = ["fa", "sp", "su", "maymester", "merrymester"] as const;
type TermSlug = (typeof TERMS)[number];

const CAMPUSES: Record<string, string> = {
  ol: "Online",
  pk: "Perkinston Campus",
  hc: "Harrison County Campus",
  jc: "Jackson County Campus",
  gc: "George County Center",
  gp: "Gulf Park Campus",
  traditions: "Bryant Center at Tradition",
  ks: "Keesler Center",
};

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

function normalizeTerm(h1Text: string): string | null {
  // "Fall 2026 - Online - Canvas" or "Spring 2027 - Perkinston Campus" etc.
  const m = h1Text.match(/(Fall|Spring|Summer|Winter|Maymester|Merrymester)\s+(\d{4})/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  if (season === "fall") return `${year}FA`;
  if (season === "spring") return `${year}SP`;
  if (season === "summer" || season === "maymester" || season === "merrymester") return `${year}SU`;
  if (season === "winter") return `${year}WI`;
  return null;
}

function parseMeetDays(raw: string): string {
  // MGCCC uses "MWF", "TR", "MTWRF" patterns directly (already canonical).
  // Sometimes the cell is empty for online sections.
  if (!raw || /TBA|ARR|^\s*$/i.test(raw)) return "";
  const out: string[] = [];
  const re = /[MTWRFSU]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw.toUpperCase())) !== null) if (!out.includes(m[0])) out.push(m[0]);
  return out.join("");
}

function parseTime24(t: string): string {
  // "08:00 AM" or "1:30 PM" or already "13:30".
  if (!t || /TBA|ARR/i.test(t)) return "";
  const ampm = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const ap = ampm[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${ampm[2]}`;
  }
  const h24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return `${String(parseInt(h24[1], 10)).padStart(2, "0")}:${h24[2]}`;
  return "";
}

function parseTimeRange(raw: string): { start: string; end: string } {
  if (!raw || /TBA|ARR/i.test(raw)) return { start: "", end: "" };
  const parts = raw.split(/[-–]/).map((s) => s.trim());
  return { start: parseTime24(parts[0] ?? ""), end: parseTime24(parts[1] ?? "") };
}

function parseSeats(raw: string): { open: number | null; total: number | null } {
  // "5/30" or "0/24"; sometimes "5 of 30".
  const m = (raw || "").match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
  if (!m) return { open: null, total: null };
  return { open: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function detectMode(format: string, campusKey: string): "in-person" | "online" | "hybrid" {
  const blob = `${format} ${campusKey}`.toLowerCase();
  if (campusKey === "ol" || /online|virtual|web\b/.test(blob)) return "online";
  if (/hybrid|hyb\b/.test(blob)) return "hybrid";
  return "in-person";
}

async function scrapeOne(term: TermSlug, campusKey: string): Promise<CourseSection[]> {
  const url = `${BASE}?term=${term}&camp=${campusKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const termKey = normalizeTerm($("h1.schedHed1").first().text());
  if (!termKey) return [];

  const sections: CourseSection[] = [];
  $("table.schedT tr").each((_, tr) => {
    const $row = $(tr);
    const $cells = $row.find("td[data-label]");
    if ($cells.length === 0) return;
    const get = (label: string) => $row.find(`td[data-label="${label}"]`).first().text().trim();

    const sub = get("SUB");
    const crse = get("CRSE");
    if (!sub || !crse) return;

    const dates = get("DATES");
    const startDate = dates.split(/-|–/)[0]?.trim() ?? "";
    const { start, end } = parseTimeRange(get("TIME"));
    const { open, total } = parseSeats(get("SEATS"));
    const format = get("FORMAT");
    const bldg = get("BLDG");
    const rm = get("RM");
    const mode = detectMode(format, campusKey);
    const campusName = CAMPUSES[campusKey] ?? "MGCCC";

    sections.push({
      college_code: SLUG,
      term: termKey,
      course_prefix: sub,
      course_number: crse,
      course_title: get("TITLE"),
      credits: parseFloat(get("CRED")) || 0,
      crn: get("CRN") || `${sub}-${crse}-${get("SEC")}`,
      days: parseMeetDays(get("MEET")),
      start_time: start,
      end_time: end,
      start_date: startDate,
      location: mode === "online" ? "Online" : [bldg, rm].filter(Boolean).join(" "),
      campus: campusName,
      mode,
      instructor: get("INSTR") || null,
      seats_open: open,
      seats_total: total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = (termIdx >= 0 ? args[termIdx + 1] : undefined) as TermSlug | undefined;
  const noImport = args.includes("--no-import");

  console.log("MGCCC — website_schedules/index.php scraper");
  const terms = termFilter ? [termFilter] : TERMS;

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  // Bucket by normalized term key — multiple URLs (one per campus +
  // mini-session) can all land in the same FA/SP/SU file.
  const byTerm = new Map<string, CourseSection[]>();

  for (const term of terms) {
    for (const camp of Object.keys(CAMPUSES)) {
      const sections = await scrapeOne(term, camp);
      if (sections.length === 0) continue;
      const key = sections[0].term;
      if (!byTerm.has(key)) byTerm.set(key, []);
      byTerm.get(key)!.push(...sections);
    }
  }

  let grand = 0;
  for (const [term, secs] of byTerm) {
    // Dedup by CRN within term — same CRN can appear in multiple campus URLs
    // when a section crosses campuses.
    const seen = new Map<string, CourseSection>();
    for (const s of secs) seen.set(s.crn, s);
    const unique = Array.from(seen.values());
    const outPath = path.join(outDir, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(unique, null, 2) + "\n");
    console.log(`  ${term}: ${unique.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grand += unique.length;
  }
  console.log(`\n${SLUG}: ${grand} total sections`);
  if (noImport) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("MGCCC scraper failed:", err);
  process.exit(1);
});
