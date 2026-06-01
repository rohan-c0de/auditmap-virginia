/**
 * Mississippi — Athena/Benchmark (ProGen WebSmart) course-schedule scraper.
 *
 * Covers the two MS colleges running Athena/Benchmark on IBM iSeries hosts.
 * Both expose the same `/athena/IXSCHED.pgm` schedule program publicly, on
 * non-standard HTTPS ports, with no authentication required:
 *
 *   southwest-mississippi-community-college →
 *     https://administration.smcc.edu:8150/athena
 *   northwest-mississippi-community-college →
 *     https://sys.northwestms.edu:461/ATHENA
 *
 * Mechanism (same on both):
 *   GET  /<athena|ATHENA>/IXSCHED.pgm                            → default landing
 *        for the active term (TERMCODE hidden in the form).
 *   POST /<athena|ATHENA>/IXSCHED.pgm  body:
 *        task=&ww_ordby=CD2DEPT&ww_orddir=ASC&page=000000000N&listsize=100
 *        &TERMCODE=<code>                                         → page N of sections.
 *   GET  /<athena|ATHENA>/IXSCHED.pgm?ww_pop=Y&ww_modPop=Y&task=ILCTERM
 *        &ww_relFld=DISPQTR&ww_listKey=fileqtr&ww_orddir=ASC&page=000000000N
 *                                                                → page N of the term list.
 *
 * Each section row in the result table has this column layout (driven by
 * the embedded SQL: CD2DEPT, CD2NUMB, CD2SECT, CD1HTITLE, CD2CRHR, CD2DAY1,
 * CD2CTTIME, CD2CAMP, CD2STAT, CD2TERM, CD2STRDTE, CD2ENDDTE, CD2PRE,
 * CD2CURENR, CD2CLSAT). The HTML's primary row carries a compact display
 * (DEPT NUMB SECT joined; days/time often "TBA" for online); the hidden
 * messageRow_<id> sibling carries the meeting/instructor detail, which we
 * parse for instructor + campus name.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-athena.ts
 *   npx tsx scripts/ms/scrape-athena.ts --college southwest-mississippi-community-college
 *   npx tsx scripts/ms/scrape-athena.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { Agent, setGlobalDispatcher } from "undici";

// Athena instances ship Oracle-Application-Server-style TLS chains that fail
// Node's default validation (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

const STATE = "ms";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface AthenaHost {
  slug: string;
  base: string; // e.g. "https://administration.smcc.edu:8150/athena"
  campusFull: string;
}

const HOSTS: AthenaHost[] = [
  {
    slug: "southwest-mississippi-community-college",
    base: "https://administration.smcc.edu:8150/athena",
    campusFull: "Southwest Mississippi Community College",
  },
  {
    slug: "northwest-mississippi-community-college",
    base: "https://sys.northwestms.edu:461/ATHENA",
    campusFull: "Northwest Mississippi Community College",
  },
];

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

interface Term {
  code: string; // e.g. "20254"
  label: string; // e.g. "SU2026" → normalized to "2026SU"
}

function normalizeTerm(label: string): string {
  // FA2026 → 2026FA, SP2027 → 2027SP, SU2026 → 2026SU, WI2026 → 2026WI.
  const m = label.match(/^(FA|SP|SU|WI)(\d{4})$/);
  return m ? `${m[2]}${m[1]}` : label;
}

function parseDays(raw: string): string {
  // Athena varies wildly by install:
  //   "M,W,F"            (SMCC fall — single letters, comma-separated)
  //   "TUE&THU"          (SMCC fall — 3-letter abbreviations, &-joined)
  //   "MON-WED-FRI"      (some)
  //   "MWF" / "TR"       (concatenated short codes)
  // Strategy: prefer 3-letter word match, then fall back to single letters,
  // mapping into the project canonical M T W R F S U set.
  if (!raw || /TBA|ARR|N\/A/i.test(raw)) return "";
  const upper = raw.toUpperCase();
  const wordMap: Record<string, string> = {
    MON: "M", TUE: "T", WED: "W", THU: "R", FRI: "F", SAT: "S", SUN: "U",
  };
  const out: string[] = [];
  // Try 3-letter words first.
  const wordMatches = upper.match(/MON|TUE|WED|THU|FRI|SAT|SUN/g);
  if (wordMatches) {
    for (const w of wordMatches) {
      const d = wordMap[w];
      if (d && !out.includes(d)) out.push(d);
    }
    return out.join("");
  }
  // Otherwise treat as concatenated short codes (e.g. "MWF", "TR", "M,W,F").
  // "TH" → R; remaining single letters M T W R F S U (project canonical).
  const cleaned = upper.replace(/TH/g, "R");
  const re = /[MTWRFSU]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out.join("");
}

function to24(raw: string): string {
  // Athena emits times in three flavours:
  //   "09:00A" / "09:50A" / "01:30P"  — compact A/P suffix (most common)
  //   "8:00 AM" / "1:30 PM"           — spaced AM/PM
  //   "13:30"                         — 24h
  if (!raw || /TBA|ARR/i.test(raw)) return "";
  const compact = raw.match(/(\d{1,2}):(\d{2})\s*([AP])M?\b/i);
  if (compact) {
    let h = parseInt(compact[1], 10);
    const ap = compact[3].toUpperCase();
    if (ap === "P" && h !== 12) h += 12;
    if (ap === "A" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${compact[2]}`;
  }
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return `${String(parseInt(h24[1], 10)).padStart(2, "0")}:${h24[2]}`;
  return "";
}

function parseCredits(raw: string): number {
  return parseFloat((raw || "").replace(/[^0-9.]/g, "")) || 0;
}

function parseTimeRange(raw: string): { start: string; end: string } {
  // Athena uses TWO separators depending on column:
  //   "09:00A 09:50A"  — single space (the visible schedule grid)
  //   "8:00 AM-9:15 AM" or "08:00-09:15" — dash (some other displays)
  if (!raw || /TBA|ARR/i.test(raw)) return { start: "", end: "" };
  // Pull every time token, take first/last.
  const tokens = raw.match(/\d{1,2}:\d{2}\s*[AP]M?|\d{1,2}:\d{2}/gi) ?? [];
  if (tokens.length === 0) return { start: "", end: "" };
  return { start: to24(tokens[0] ?? ""), end: to24(tokens[tokens.length - 1] ?? "") };
}

function detectMode(days: string, campusName: string): "in-person" | "online" | "hybrid" {
  const blob = `${days} ${campusName}`.toLowerCase();
  if (/online|on-?line|virtual|web\b/.test(blob)) return "online";
  if (/hybrid|hyb\b/.test(blob)) return "hybrid";
  if (!days || /tba|arr/i.test(days)) {
    // No meeting pattern at all + no campus signal → fall back to in-person
    // (Athena leaves TBA on many self-paced lab sections).
    return "in-person";
  }
  return "in-person";
}

async function fetchHtml(url: string, opts: RequestInit = {}): Promise<string> {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function listTerms(base: string): Promise<Term[]> {
  // Load the term-list ILC. Athena returns one page at a time; we walk
  // forward until no rows show up.
  const seen = new Map<string, string>();
  for (let page = 1; page <= 12; page++) {
    const url =
      `${base}/IXSCHED.pgm?ww_pop=Y&ww_modPop=Y&task=ILCTERM` +
      `&ww_relFld=DISPQTR&ww_listKey=fileqtr&ww_orddir=ASC&page=000000000${page}`;
    let html = "";
    try {
      html = await fetchHtml(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    let added = 0;
    $("tr[id^='row']").each((_, tr) => {
      const tds = $(tr).find("td");
      const label = $(tds[0]).text().trim();
      // hidden input hQtr<N> carries the canonical TERMCODE.
      const code = $(tr).find("input[id^='hQtr']").attr("value") || "";
      if (label && code && !seen.has(code)) {
        seen.set(code, label);
        added++;
      }
    });
    if (added === 0) break;
  }
  // Fallback: pull whatever the default landing page advertises.
  if (seen.size === 0) {
    const html = await fetchHtml(`${base}/IXSCHED.pgm`);
    const $ = cheerio.load(html);
    const code = $("input#TERMCODE").attr("value") || "";
    const label = $("input#DISPQTR").attr("value") || "";
    if (code && label) seen.set(code, label);
  }
  return Array.from(seen, ([code, label]) => ({ code, label }));
}

function parseSections(host: AthenaHost, term: Term, html: string): CourseSection[] {
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];
  const normTerm = normalizeTerm(term.label);

  $("tr[id^='row_']").each((_, el) => {
    const id = ($(el).attr("id") || "").replace(/^row_/, "");
    const tds = $(el).find("> td").toArray().map((td) => $(td).text().trim());
    if (tds.length < 8) return;

    // Column 1: "DEPT NUMB SECT" joined with spaces, e.g. "ACC 2213 Z".
    const courseStr = tds[0];
    const parts = courseStr.split(/\s+/);
    if (parts.length < 3) return;
    const prefix = parts[0];
    const number = parts[1];
    const section = parts.slice(2).join("");
    if (!/^[A-Z]/.test(prefix) || !/\d/.test(number)) return;

    const title = tds[1];
    const credits = parseCredits(tds[2]);
    const daysCell = tds[3];
    const timeCell = tds[4];

    // Column layout (visible cells, after the commented-out instructor block):
    //   [0]course  [1]title  [2]credits  [3]days  [4]time  [5]status  [6]mini-term
    //   [7]start-date  [8]end-date  [9]pre  [10]reg  [11]total-enrolled
    //   [12]close/capacity
    const dateCells = tds.filter((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
    const startDate = dateCells[0] ?? "";

    // Capacity = trailing td ("Close"); enrolled = td-1 ("Total").
    const numericTail = tds
      .slice(-4)
      .map((t) => (/^\d+$/.test(t) ? parseInt(t, 10) : null));
    const cap = numericTail[3] ?? null;
    const enrolled = numericTail[2] ?? null;
    const seatsTotal = cap;
    const seatsOpen = cap !== null && enrolled !== null ? Math.max(cap - enrolled, 0) : null;

    const days = parseDays(daysCell);
    const { start: startTime, end: endTime } = parseTimeRange(timeCell);

    // Pull instructor + campus name from the matching messageRow_<id>.
    let instructor: string | null = null;
    let campusName = host.campusFull;
    const $msg = $(`#messageRow${id}`);
    if ($msg.length) {
      const $detailRows = $msg.find("table.textTable").last().find("tr");
      // Each meeting row: Instructor | Day | Time | Minutes | Campus | Bldg | Room | Books
      $detailRows.each((_, dr) => {
        const cells = $(dr).find("td").toArray().map((td) => $(td).text().trim());
        if (cells.length >= 5) {
          if (!instructor && cells[0] && cells[0] !== "TBA") instructor = cells[0];
          if (cells[4] && cells[4] !== "TBA") campusName = cells[4];
        }
      });
    }

    const mode = detectMode(daysCell, campusName);
    sections.push({
      college_code: host.slug,
      term: normTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn: `${prefix}-${number}-${section}`,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: mode === "online" ? "Online" : campusName,
      campus: campusName,
      mode,
      instructor,
      seats_open: seatsOpen,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function scrapeTerm(host: AthenaHost, term: Term): Promise<CourseSection[]> {
  const out: CourseSection[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = new URLSearchParams({
      task: "",
      ww_ordby: "CD2DEPT",
      ww_orddir: "ASC",
      page: String(page).padStart(10, "0"),
      listsize: "100",
      TERMCODE: term.code,
      DISPQTR: term.label,
    });
    const res = await fetch(`${host.base}/IXSCHED.pgm`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${host.slug} ${term.label} page ${page}`);
    const html = await res.text();
    const batch = parseSections(host, term, html);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function scrapeCollege(host: AthenaHost): Promise<{ slug: string; sections: number }> {
  console.log(`\n=== ${host.slug} (${host.base}) ===`);
  const terms = await listTerms(host.base);
  console.log(`  Terms discovered: ${terms.map((t) => t.label).join(", ") || "(none)"}`);
  if (terms.length === 0) return { slug: host.slug, sections: 0 };

  const outDir = path.join(process.cwd(), "data", STATE, "courses", host.slug);
  fs.mkdirSync(outDir, { recursive: true });

  let total = 0;
  for (const term of terms) {
    const sections = await scrapeTerm(host, term);
    if (sections.length === 0) {
      console.log(`  ${term.label}: 0 sections (skipping)`);
      continue;
    }
    const normTerm = normalizeTerm(term.label);
    const outPath = path.join(outDir, `${normTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${normTerm}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    total += sections.length;
  }
  return { slug: host.slug, sections: total };
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("Mississippi Athena/Benchmark scraper");
  const targets = collegeFilter ? HOSTS.filter((h) => h.slug === collegeFilter) : HOSTS;
  if (targets.length === 0) {
    throw new Error(`Unknown college: ${collegeFilter}. Known: ${HOSTS.map((h) => h.slug).join(", ")}`);
  }

  const results: Array<{ slug: string; sections: number }> = [];
  for (const host of targets) {
    try {
      results.push(await scrapeCollege(host));
    } catch (err) {
      console.error(`  ERROR on ${host.slug}: ${(err as Error).message}`);
      results.push({ slug: host.slug, sections: 0 });
    }
  }

  console.log("\n=== Summary ===");
  let grand = 0;
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.sections} sections`);
    grand += r.sections;
  }
  console.log(`  Total: ${grand} sections across ${results.length} colleges`);
  if (noImport) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("Mississippi Athena scraper failed:", err);
  process.exit(1);
});
