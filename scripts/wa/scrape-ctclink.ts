/**
 * scrape-ctclink.ts — Washington SBCTC ctcLink class search
 *
 * All 33 Washington community/technical colleges share a single HighPoint
 * HCX / PeopleSoft instance at csprd.ctclink.us. Class search is publicly
 * accessible through the HCX Mobile guest endpoints — no authentication
 * needed; a single GET to the entry URL sets a PS guest session cookie.
 *
 * API:
 *   Entry (sets cookies):
 *     GET /psc/csprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main?institution={WAxxx}
 *   Options (terms, subjects, instructions modes):
 *     GET /psc/csprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearchOptions?institution={WAxxx}&term=&x_acad_career=
 *   Search (paginated, 200 per page):
 *     GET /psc/csprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch?institution={WAxxx}&term={strm}&enrl_stat=&crse_attr=&crse_attr_value=&page={N}
 *
 * Each search response is JSON with shape:
 *   { pageCount: number, classes: ClassRecord[] }
 *
 * Term codes (strm): 226{1=Winter, 3=Spring, 5=Summer, 7=Fall}
 *   2263 SPRING 2026  (default — most recent past)
 *   2265 SUMMER 2026
 *   2267 FALL 2026
 *   2271 WINTER 2027
 *   2273 SPRING 2027
 *
 * Usage:
 *   npx tsx scripts/wa/scrape-ctclink.ts
 *   npx tsx scripts/wa/scrape-ctclink.ts --term "Fall 2026"
 *   npx tsx scripts/wa/scrape-ctclink.ts --term "Fall 2026,Spring 2027"
 *   npx tsx scripts/wa/scrape-ctclink.ts --slug bellevue-college
 *   npx tsx scripts/wa/scrape-ctclink.ts --institution WA080
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = "https://csprd.ctclink.us/psc/csprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main";
const SEARCH_URL = "https://csprd.ctclink.us/psc/csprd/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const DATA_DIR = path.join(process.cwd(), "data", "wa", "courses");
const REQUEST_DELAY_MS = 350; // polite pause between API calls
const MAX_PAGES = 100; // safety cap

// HCX-Mobile institution codes from the SBCTC tenant config.
// Mapping: institution code → community-college-path slug.
const INSTITUTION_TO_SLUG: Record<string, string> = {
  WA010: "peninsula-college",
  WA020: "grays-harbor-college",
  WA030: "olympic-college",
  WA040: "skagit-valley-college",
  WA050: "everett-community-college",
  WA062: "seattle-central-college",
  WA063: "north-seattle-college",
  WA064: "south-seattle-college",
  WA070: "shoreline-community-college",
  WA080: "bellevue-college",
  WA090: "highline-college",
  WA100: "green-river-college",
  WA110: "pierce-college-district",
  WA120: "centralia-college",
  WA130: "lower-columbia-college",
  WA140: "clark-college",
  WA150: "wenatchee-valley-college",
  WA160: "yakima-valley-college",
  WA171: "spokane-community-college",
  WA172: "spokane-falls-community-college",
  WA180: "big-bend-community-college",
  WA190: "columbia-basin-college",
  WA200: "walla-walla-community-college",
  WA210: "whatcom-community-college",
  WA220: "tacoma-community-college",
  WA230: "edmonds-college",
  WA240: "south-puget-sound-community-college",
  WA250: "bellingham-technical-college",
  WA260: "lake-washington-institute-of-technology",
  WA270: "renton-technical-college",
  WA280: "bates-technical-college",
  WA290: "clover-park-technical-college",
  WA300: "cascadia-college",
};

const TERM_CODES: Record<string, string> = {
  "Spring 2026": "2263",
  "Summer 2026": "2265",
  "Fall 2026": "2267",
  "Winter 2027": "2271",
  "Spring 2027": "2273",
};

const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026": "2026FA",
  "Winter 2027": "2027WI",
  "Spring 2027": "2027SP",
};

const DEFAULT_TERMS = "Summer 2026,Fall 2026,Winter 2027,Spring 2027";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassRecord {
  strm: string;
  class_nbr: number;
  class_section: string;
  subject: string;
  catalog_nbr: string;
  descr: string;
  units: string | number;
  instruction_mode: string;
  instruction_mode_descr: string;
  campus: string;
  campus_descr: string;
  location_descr: string;
  class_capacity: number;
  enrollment_total: number;
  enrollment_available: number;
  enrl_stat_descr: string;
  start_dt: string; // MM/DD/YYYY
  end_dt: string;
  instructors: { name: string; email: string }[];
  meetings: {
    days: string;
    start_time: string; // "HH.MM.SS.000000" or ""
    end_time: string;
    start_dt: string;
    end_dt: string;
    facility_descr: string;
    room: string;
    instructor: string;
  }[];
}

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
  start_date: string; // YYYY-MM-DD
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface ParsedTerm {
  termName: string;
  strm: string;
  fileTermCode: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let slugFilter: string | null = null;
  let institutionFilter: string | null = null;
  let termArg = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termArg = args[i + 1];
      i++;
    } else if (args[i] === "--slug" && args[i + 1]) {
      slugFilter = args[i + 1];
      i++;
    } else if (args[i] === "--institution" && args[i + 1]) {
      institutionFilter = args[i + 1].toUpperCase();
      i++;
    }
  }

  if (!termArg) termArg = DEFAULT_TERMS;

  const termNames = termArg.split(",").map((t) => t.trim()).filter(Boolean);
  const terms: ParsedTerm[] = [];
  for (const termName of termNames) {
    const strm = TERM_CODES[termName];
    const fileTermCode = TERM_FILE_CODES[termName];
    if (!strm || !fileTermCode) {
      console.error(`Unknown term: "${termName}". Available: ${Object.keys(TERM_CODES).join(", ")}`);
      process.exit(1);
    }
    terms.push({ termName, strm, fileTermCode });
  }

  return { slugFilter, institutionFilter, terms };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface SessionCookies {
  jar: Map<string, string>;
}

function emptyJar(): SessionCookies {
  return { jar: new Map() };
}

function cookieHeader(s: SessionCookies): string {
  return [...s.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbSetCookie(s: SessionCookies, headerValues: string[] | string | undefined) {
  if (!headerValues) return;
  const arr = Array.isArray(headerValues) ? headerValues : [headerValues];
  for (const raw of arr) {
    // Each Set-Cookie value may include multiple separators; we only care about name=value before first ;
    const first = raw.split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    s.jar.set(name, value);
  }
}

async function fetchWithCookies(url: string, s: SessionCookies, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  headers.set("User-Agent", UA);
  if (s.jar.size > 0) headers.set("Cookie", cookieHeader(s));
  const r = await fetch(url, { ...opts, headers, redirect: "follow" });
  // Node fetch surfaces multiple Set-Cookies as getSetCookie()
  const setCookies = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : r.headers.get("set-cookie");
  if (setCookies) absorbSetCookie(s, setCookies);
  return r;
}

async function establishSession(institution: string): Promise<SessionCookies> {
  const s = emptyJar();
  const r = await fetchWithCookies(`${BASE}?institution=${institution}`, s);
  if (!r.ok && r.status !== 302) {
    throw new Error(`establishSession ${institution}: HTTP ${r.status}`);
  }
  // Drain body
  await r.text();
  return s;
}

async function fetchPage(institution: string, strm: string, page: number, s: SessionCookies): Promise<{ pageCount: number; classes: ClassRecord[] }> {
  const url = `${SEARCH_URL}?institution=${institution}&term=${strm}&enrl_stat=&crse_attr=&crse_attr_value=&page=${page}`;
  const r = await fetchWithCookies(url, s);
  if (!r.ok) throw new Error(`fetchPage ${institution} ${strm} p${page}: HTTP ${r.status}`);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`fetchPage ${institution} ${strm} p${page}: non-JSON response (${text.slice(0, 100)})`);
  }
}

function parseTimeHHMMSS(t: string): string {
  // "17.30.00.000000" → "17:30"; "" → ""
  if (!t) return "";
  const m = /^(\d{2})\.(\d{2})/.exec(t);
  if (!m) return "";
  return `${m[1]}:${m[2]}`;
}

function parseDateMDY(s: string): string {
  // "08/24/2026" → "2026-08-24"; "" → ""
  if (!s) return "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Map a raw ctcLink `instruction_mode_descr` to the canonical delivery-mode
 * enum the import schema requires ("in-person" | "online" | "hybrid" | "zoom").
 *
 * ctcLink emits ~12 free-text descriptions; passing them through verbatim made
 * 100% of WA rows fail schema validation, so every (college, term) aborted and
 * WA imported 0 sections (discovered 2026-06-01). The full observed vocabulary,
 * by frequency:
 *   Online Asynchronous, Hybrid, In-Person (Web Enhanced), In Person,
 *   Online Scheduled, Online Asynchron. w/In-Person, Flexible,
 *   Online Scheduled w/In-Person, Individualized Instruction, Other,
 *   Self-Paced, On-line
 *
 * Rules (checked in order — "mixed" wins over "online"):
 *   1. anything that combines online + in-person, or is hyflex/"flexible"  -> hybrid
 *   2. anything online / on-line / self-paced                              -> online
 *   3. everything else (in-person, web-enhanced, individualized, other)    -> in-person
 *
 * We deliberately fold synchronous "Online Scheduled" into `online` rather than
 * `zoom`: ctcLink doesn't tell us the meeting tool, and labeling a class "zoom"
 * we can't confirm is riskier than the true-but-less-specific "online". Errs
 * toward not over-promising a delivery format. Exported for the one-time
 * migration of already-scraped files (scripts/wa/normalize-existing-modes.ts).
 */
export function normalizeCtclinkMode(
  raw: string,
): "in-person" | "online" | "hybrid" | "zoom" {
  const s = (raw || "").toLowerCase();
  const hasInPerson = s.includes("in-person") || s.includes("in person");
  const hasOnline = s.includes("online") || s.includes("on-line");
  // Mixed delivery (online + in-person), or hyflex/flexible -> hybrid.
  if (s.includes("hybrid") || s.includes("flexible")) return "hybrid";
  if (hasOnline && hasInPerson) return "hybrid";
  // Purely remote.
  if (hasOnline || s.includes("self-paced")) return "online";
  // In person, web-enhanced, individualized, other, or empty -> in-person.
  return "in-person";
}

function transformClass(c: ClassRecord, slug: string, termName: string): CourseSection {
  const credits = typeof c.units === "string" ? parseFloat(c.units) || 0 : c.units ?? 0;
  // Pick first meeting (most classes have one; multi-meeting take the primary)
  const m = c.meetings?.[0];
  const days = m?.days ?? "";
  const start_time = parseTimeHHMMSS(m?.start_time ?? "");
  const end_time = parseTimeHHMMSS(m?.end_time ?? "");
  const start_date = parseDateMDY(m?.start_dt ?? c.start_dt ?? "");
  const location = [m?.facility_descr, m?.room].filter((x) => x && x.trim()).join(" ");
  const instr = c.instructors?.[0]?.name ?? null;
  const seats_open = typeof c.enrollment_available === "number" ? c.enrollment_available : null;
  const seats_total = typeof c.class_capacity === "number" ? c.class_capacity : null;

  return {
    college_code: slug,
    term: termName,
    course_prefix: (c.subject ?? "").trim(),
    course_number: (c.catalog_nbr ?? "").toString().trim(),
    course_title: (c.descr ?? "").trim(),
    credits,
    crn: c.class_nbr?.toString() ?? "",
    days,
    start_time,
    end_time,
    start_date,
    location,
    campus: c.campus_descr ?? "",
    mode: normalizeCtclinkMode(c.instruction_mode_descr ?? ""),
    instructor: instr && instr !== "Staff" ? instr : instr === "Staff" ? "Staff" : null,
    seats_open,
    seats_total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Per-institution scrape
// ---------------------------------------------------------------------------

interface ScrapeResult {
  slug: string;
  institution: string;
  term: string;
  fileTermCode: string;
  totalClasses: number;
  pages: number;
  error?: string;
}

async function scrapeInstitutionTerm(
  institution: string,
  slug: string,
  termName: string,
  strm: string,
  fileTermCode: string,
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    slug,
    institution,
    term: termName,
    fileTermCode,
    totalClasses: 0,
    pages: 0,
  };
  try {
    const s = await establishSession(institution);
    const allClasses: ClassRecord[] = [];
    let pageCount = MAX_PAGES;
    for (let page = 1; page <= MAX_PAGES; page++) {
      await sleep(REQUEST_DELAY_MS);
      const resp = await fetchPage(institution, strm, page, s);
      const got = resp.classes?.length ?? 0;
      // pageCount is only reported on page 1; subsequent pages return 0.
      if (page === 1) pageCount = resp.pageCount ?? 1;
      if (got === 0) break;
      allClasses.push(...resp.classes);
      result.pages = page;
      if (page >= pageCount) break;
    }
    if (allClasses.length === 0) return result;
    const sections = allClasses.map((c) => transformClass(c, slug, termName));
    // Write to per-college term file
    const dir = path.join(DATA_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${fileTermCode}.json`);
    fs.writeFileSync(file, JSON.stringify(sections, null, 2));
    result.totalClasses = sections.length;
  } catch (e) {
    result.error = String((e as Error).message ?? e);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { slugFilter, institutionFilter, terms } = parseArgs();

  const allInstitutions = Object.entries(INSTITUTION_TO_SLUG).filter(([inst, slug]) => {
    if (slugFilter && slug !== slugFilter) return false;
    if (institutionFilter && inst !== institutionFilter) return false;
    return true;
  });

  if (allInstitutions.length === 0) {
    console.error("No institutions selected.");
    process.exit(1);
  }

  console.log(`[scrape-ctclink] ${allInstitutions.length} institutions × ${terms.length} terms = ${allInstitutions.length * terms.length} (inst, term) jobs`);
  console.log(`[scrape-ctclink] terms: ${terms.map((t) => t.termName).join(", ")}`);

  const results: ScrapeResult[] = [];
  const t0 = Date.now();

  for (const [inst, slug] of allInstitutions) {
    for (const term of terms) {
      const tStart = Date.now();
      const r = await scrapeInstitutionTerm(inst, slug, term.termName, term.strm, term.fileTermCode);
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      const status = r.error ? `ERROR: ${r.error}` : `${r.totalClasses} sections (${r.pages} pages)`;
      console.log(`[${slug}/${term.fileTermCode}] ${status} — ${dt}s`);
      results.push(r);
    }
  }

  const totalSections = results.reduce((a, r) => a + r.totalClasses, 0);
  const errors = results.filter((r) => r.error);
  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  console.log(`\n[scrape-ctclink] done — ${totalSections} total sections across ${results.length} (inst, term) jobs in ${elapsed} min`);
  if (errors.length > 0) {
    console.log(`[scrape-ctclink] ${errors.length} errors:`);
    for (const e of errors) console.log(`  ${e.slug}/${e.fileTermCode}: ${e.error}`);
  }
}

// Only run the scraper when this file is executed directly (e.g.
// `tsx scripts/wa/scrape-ctclink.ts`), NOT when another module imports it for a
// helper like normalizeCtclinkMode. Without this guard, importing the file
// kicked off a live scrape of all 33 WA colleges as a side effect. Matches the
// direct-run convention used by scripts/ky/scrape-courses.ts and others.
const isDirectRun =
  import.meta.url.startsWith("file:") &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
