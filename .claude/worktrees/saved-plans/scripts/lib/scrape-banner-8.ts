/**
 * scrape-banner-8.ts (template)
 *
 * Parameterized Banner 8 (legacy "classic" Banner) course-section scraper.
 * Targets the PL/SQL HTML pages exposed at `bwckschd.p_disp_dyn_sched` /
 * `bwckschd.p_get_crse_unsec` / `bwckgens.p_proc_term_date`. Uses direct
 * HTTP POST — no browser needed, unlike the Colleague template (PR 3).
 *
 * Existing per-state Banner 8 scrapers in scripts/{de,ma,md,nh,ri,sc}/
 * are NOT modified by this PR. They continue producing data exactly as
 * they do today; refactoring them to call this template is deferred to
 * future per-state PRs after the auto-add-state orchestrator (PR 7) has
 * proven the template on real new-state runs.
 *
 * The template supports the two deployment shapes Banner 8 ships in:
 *   1. One host per college (DE/MA/MD/RI/SC) — pass a `hosts` map.
 *      Each college is scraped per-subject.
 *   2. Shared instance (NH/CCSNH — 7 colleges share one Banner 8) — pass
 *      `sharedInstance.baseUrl` + a `sel_levl` → slug map. Each college
 *      is scraped with the appropriate level selector.
 *
 * Usage as a library (per-host case):
 *
 *   import { scrapeBanner8ByHost } from "../lib/scrape-banner-8";
 *
 *   await scrapeBanner8ByHost({
 *     state: "ky",
 *     hosts: {
 *       "ashland":   "https://ssbprod.kctcs.edu/PROD",
 *       "elizabethtown": "https://etown.kctcs.edu/PROD",
 *     },
 *   });
 *
 * Usage as a library (shared-instance case):
 *
 *   await scrapeBanner8SharedInstance({
 *     state: "nh",
 *     baseUrl: "https://sis.ccsnh.edu/ssb8",
 *     levelToCollege: { "GB": "gbcc", "TI": "nhti", "MC": "mccnh", ... },
 *   });
 *
 * Smoke test (read-only):
 *
 *   npx tsx scripts/lib/scrape-banner-8.ts --smoke \
 *     --url https://ssb.hgtc.edu/PROD9 --slug horry-georgetown --state sc
 *
 * Output schema matches every existing Banner 8 scraper:
 *
 *   { college_code, term, course_prefix, course_number, course_title,
 *     credits, crn, days, start_time, end_time, start_date, location,
 *     campus, mode, instructor, seats_open, seats_total,
 *     prerequisite_text, prerequisite_courses }
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

export interface CourseSection {
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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

export interface BannerTerm {
  code: string;
  description: string;
}

export interface ScraperHooks {
  /**
   * Map a Banner term code + description to the standard `YYYYxx` form
   * (`2026FA`, `2026SP`, `2026SU`). Default reads year from the
   * description and uses suffix-based fallback (10=FA, 20=SP, 30=SU).
   * Override for fiscal-year codes (HGTC's pattern: 202610=Fall 2026
   * but 202520=Spring 2026, off-by-one academic year).
   */
  termCodeToStandard?: (code: string, description: string) => string;

  /**
   * Convert a CLI-friendly term input ("Fall 2026", "Summer 2026") to a
   * Banner term code. Used by smoke-test CLI and per-state callers.
   * Default tries the same description-based logic the standard mapper uses.
   */
  termNameToCode?: (input: string) => string;

  /**
   * Override the in-person/online/hybrid/zoom heuristic. Default uses
   * the section's instructional method + campus + meeting location.
   */
  detectMode?: (input: {
    method: string;
    campus: string;
    location: string;
  }) => CourseMode;

  /**
   * Filter candidate terms before scraping. Default keeps the current
   * + next term per pickRecentSsbTerms-style heuristic.
   */
  filterTerms?: (terms: BannerTerm[]) => BannerTerm[];
}

const DEFAULT_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const PROBE_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultTermCodeToStandard(
  code: string,
  description: string
): string {
  const desc = description.toLowerCase();
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.slice(0, 4);
  if (desc.includes("fall")) return `${year}FA`;
  if (desc.includes("spring") || desc.includes("winter")) return `${year}SP`;
  if (desc.includes("summer")) return `${year}SU`;

  // Suffix fallback — common Banner 8 convention 10=FA, 20=SP, 30=SU.
  const suffix = code.slice(4, 6);
  if (suffix === "10") return `${year}FA`;
  if (suffix === "20") return `${year}SP`;
  if (suffix === "30") return `${year}SU`;
  return `${year}XX`;
}

export function defaultDetectMode(input: {
  method: string;
  campus: string;
  location: string;
}): CourseMode {
  const s = `${input.method} ${input.campus} ${input.location}`.toLowerCase();
  if (s.includes("synchronous online") || s.includes("synchronous remote")) {
    return "zoom";
  }
  if (s.includes("hybrid")) return "hybrid";
  if (
    s.includes("online") ||
    s.includes("internet") ||
    s.includes("distance learning") ||
    s.includes("web-based")
  ) {
    return "online";
  }
  return "in-person";
}

/** Pick the current + next 1-2 academic terms from a Banner 8 term list.
 * Banner 8 doesn't have a "View Only" annotation like SSB; we rely on
 * description-based season + year matching against the calendar. */
export function defaultFilterTerms(terms: BannerTerm[]): BannerTerm[] {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  // We're interested in: current calendar season's term + the next two.
  const seasonRank = (s: string) =>
    s === "spring" ? 1 : s === "summer" ? 2 : s === "fall" ? 3 : 0;
  let curSeason: "spring" | "summer" | "fall";
  if (month <= 5) curSeason = "spring";
  else if (month <= 7) curSeason = "summer";
  else curSeason = "fall";
  const curRank = year * 10 + seasonRank(curSeason);

  return terms.filter((t) => {
    const desc = t.description.toLowerCase();
    if (desc.includes("view only") || desc.includes("(view")) return false;
    const yearMatch = desc.match(/\b(20\d{2})\b/);
    let season: string | null = null;
    if (desc.includes("spring") || desc.includes("winter")) season = "spring";
    else if (desc.includes("summer")) season = "summer";
    else if (desc.includes("fall")) season = "fall";
    if (!yearMatch || !season) return false;
    const rank = parseInt(yearMatch[1]) * 10 + seasonRank(season);
    return rank >= curRank;
  });
}

// ---------------------------------------------------------------------------
// Banner 8 HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the term dropdown from the schedule landing page. Banner 8 ships
 * the term list as `<OPTION VALUE="YYYYSS">Description</OPTION>` on
 * `bwckschd.p_disp_dyn_sched`.
 */
export async function getBanner8Terms(baseUrl: string): Promise<BannerTerm[]> {
  const resp = await fetch(`${baseUrl}/bwckschd.p_disp_dyn_sched`, {
    headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const html = await resp.text();
  const terms: BannerTerm[] = [];
  // Banner ships <OPTION VALUE="..."> in upper or mixed case depending on PL/SQL version
  const optionRe = /<option\s+value="(\d{6})"[^>]*>([^<]+)<\/option>/gi;
  let m;
  while ((m = optionRe.exec(html)) !== null) {
    terms.push({ code: m[1], description: m[2].trim() });
  }
  return terms;
}

/**
 * Fetch the subject dropdown for a given term. Banner 8 surfaces subjects
 * via `bwckgens.p_proc_term_date` after the term is selected.
 */
export async function getBanner8Subjects(
  baseUrl: string,
  termCode: string
): Promise<string[]> {
  const resp = await fetch(`${baseUrl}/bwckgens.p_proc_term_date`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: `p_calling_proc=bwckschd.p_disp_dyn_sched&p_term=${termCode}`,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const html = await resp.text();
  const subjects: string[] = [];
  const optionRe = /<option\s+value="([A-Z]{2,4})"/gi;
  let m;
  while ((m = optionRe.exec(html)) !== null) {
    if (m[1] !== "%" && m[1] !== "dummy") subjects.push(m[1]);
  }
  return [...new Set(subjects)];
}

/**
 * Run the schedule search for a given (term, subject) — or for a given
 * (term, level) when the caller wants to scope by `sel_levl` (the
 * shared-instance mechanism CCSNH uses to host 7 colleges on one Banner).
 *
 * Returns the raw HTML for downstream parsing.
 */
export interface SearchFilter {
  /** Subject prefix (e.g. "ENG"). Mutually exclusive with `level`. */
  subject?: string;
  /** Banner level code (e.g. "TI" for NHTI on CCSNH). Mutually exclusive with `subject`. */
  level?: string;
}

export async function searchBanner8(
  baseUrl: string,
  termCode: string,
  filter: SearchFilter
): Promise<string> {
  const params = new URLSearchParams();
  params.append("term_in", termCode);
  // Banner 8's get_crse_unsec endpoint requires every multi-select to
  // include a leading "dummy" placeholder before the real value(s).
  params.append("sel_subj", "dummy");
  params.append("sel_subj", filter.subject ?? "%");
  params.append("sel_day", "dummy");
  params.append("sel_schd", "dummy");
  params.append("sel_schd", "%");
  params.append("sel_insm", "dummy");
  params.append("sel_insm", "%");
  params.append("sel_camp", "dummy");
  params.append("sel_camp", "%");
  params.append("sel_levl", "dummy");
  params.append("sel_levl", filter.level ?? "%");
  params.append("sel_sess", "dummy");
  params.append("sel_sess", "%");
  params.append("sel_instr", "dummy");
  params.append("sel_instr", "%");
  params.append("sel_ptrm", "dummy");
  params.append("sel_ptrm", "%");
  params.append("sel_attr", "dummy");
  params.append("sel_attr", "%");
  params.append("sel_crse", "");
  params.append("sel_title", "");
  params.append("sel_from_cred", "");
  params.append("sel_to_cred", "");
  params.append("begin_hh", "0");
  params.append("begin_mi", "0");
  params.append("begin_ap", "a");
  params.append("end_hh", "0");
  params.append("end_mi", "0");
  params.append("end_ap", "a");

  const resp = await fetch(`${baseUrl}/bwckschd.p_get_crse_unsec`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: params.toString(),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return resp.text();
}

// ---------------------------------------------------------------------------
// HTML parsing
//
// Banner 8 schedule output is a sequence of:
//   <th class="ddtitle"><a ...>Course Title - CRN - SUBJ NUM - SectionNo</a></th>
//   <td class="dddefault">
//     ...credits, campus, instructional method...
//     <table class="datadisplaytable">
//       <tr>...meeting time row...</tr>
//     </table>
//   </td>
//
// The structure is consistent across ~15 years of Banner 8 deployments.
// ---------------------------------------------------------------------------

const BANNER_DAY_LETTER: Record<string, string> = {
  M: "M",
  T: "Tu",
  W: "W",
  R: "Th",
  F: "F",
  S: "Sa",
  U: "Su",
};

function bannerDaysToStandard(raw: string): string {
  return raw
    .split("")
    .map((c) => BANNER_DAY_LETTER[c] ?? "")
    .filter(Boolean)
    .join(" ");
}

function parseBannerDate(raw: string): string {
  // Banner ships dates as either "MMM DD, YYYY" or "MM/DD/YYYY". Try both.
  const m1 = raw.match(/(\w{3,9})\s+(\d{1,2}),\s+(\d{4})/);
  if (m1) {
    const d = new Date(`${m1[1]} ${m1[2]}, ${m1[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const m2 = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  return "";
}

export interface ParseOptions {
  collegeSlug: string;
  standardTerm: string;
  detectMode?: ScraperHooks["detectMode"];
}

export function parseBanner8Html(
  html: string,
  opts: ParseOptions
): CourseSection[] {
  const sections: CourseSection[] = [];
  const detect = opts.detectMode ?? defaultDetectMode;

  // Find every course-block boundary by scanning for ddtitle anchors.
  const titleRe = /<th\s+class="ddtitle"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi;
  const titles: { text: string; index: number }[] = [];
  let tm;
  while ((tm = titleRe.exec(html)) !== null) {
    titles.push({ text: tm[1].trim(), index: tm.index });
  }

  for (let i = 0; i < titles.length; i++) {
    const { text, index } = titles[i];
    const parts = text.split(" - ");
    if (parts.length < 4) continue;

    const courseTitle = parts[0].trim();
    const crn = parts[1].trim();
    const subjNum = parts[2].trim();
    const subjMatch = subjNum.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
    if (!subjMatch) continue;
    const [, prefix, number] = subjMatch;

    const endIdx = i + 1 < titles.length ? titles[i + 1].index : html.length;
    const detail = html.slice(index, endIdx);

    // Credits — "3.000 Credits" or "3.0 Credits"
    const creditMatch = detail.match(/([\d.]+)\s+Credits/);
    const credits = creditMatch ? parseFloat(creditMatch[1]) : 0;

    // Campus — common values across schools. Pure heuristic; per-state
    // hooks can override via the detail block they receive.
    const campusMatch = detail.match(
      /(?:Main Campus|Online|Hybrid|Off Campus|Off Site|Distance Learning)[^<\n]*/i
    );
    const campus = campusMatch ? campusMatch[0].trim() : "";

    // Instructional method line (separate from campus on most installs)
    const methodMatch = detail.match(
      /(Online|Hybrid|Lecture|Lab|Lecture and Lab|Off Campus|Synchronous Online|Asynchronous)[^<\n]*Instructional Method/i
    );
    const method = methodMatch ? methodMatch[1] : "";

    // Meeting-times table — extract the first row's days/times/where/dates/instructor
    let days = "";
    let startTime = "";
    let endTime = "";
    let startDate = "";
    let location = "";
    let instructor: string | null = null;

    const tableMatch = detail.match(
      /<table[^>]*class="datadisplaytable"[^>]*>([\s\S]*?)<\/table>/i
    );
    if (tableMatch) {
      const rowRe = /<tr>\s*((?:<td[^>]*>[\s\S]*?<\/td>\s*)+)<\/tr>/gi;
      let rm;
      while ((rm = rowRe.exec(tableMatch[1])) !== null) {
        const cells: string[] = [];
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRe.exec(rm[1])) !== null) {
          cells.push(cm[1].replace(/<[^>]*>/g, "").trim());
        }
        // Schema: Type(0) Time(1) Days(2) Where(3) DateRange(4) ScheduleType(5) Instructors(6)
        if (cells.length >= 7) {
          if (cells[1] && cells[1] !== "TBA") {
            const tParts = cells[1].split(" - ");
            if (tParts.length === 2) {
              startTime = tParts[0].trim();
              endTime = tParts[1].trim();
            }
          }
          if (cells[2] && cells[2] !== "TBA") {
            days = bannerDaysToStandard(cells[2]);
          }
          location = cells[3] || "";
          if (cells[4]) startDate = parseBannerDate(cells[4]);
          if (cells[6]) {
            const inst = cells[6].replace(/\(P\)/, "").replace(/\s+/g, " ").trim();
            if (inst && inst !== "TBA") instructor = inst;
          }
          break; // first meeting row only
        }
      }
    }

    sections.push({
      college_code: opts.collegeSlug,
      term: opts.standardTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: courseTitle,
      credits,
      crn,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location,
      campus,
      mode: detect({ method, campus, location }),
      instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Per-host orchestration (one Banner 8 instance per college)
// ---------------------------------------------------------------------------

export interface ScrapeBanner8CollegeOptions {
  state: string;
  slug: string;
  baseUrl: string;
  termOverrides?: string[]; // optional: list of term codes or descriptions
  hooks?: ScraperHooks;
  dryRun?: boolean;
  silent?: boolean;
  /** Pause between subject HTTP requests, ms. Default 200. */
  delayMs?: number;
}

export interface ScrapeCollegeResult {
  slug: string;
  baseUrl: string;
  totalSections: number;
  termsScraped: { code: string; description: string; standardTerm: string; sections: number }[];
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scrapeBanner8College(
  opts: ScrapeBanner8CollegeOptions
): Promise<ScrapeCollegeResult> {
  const log = opts.silent ? () => {} : (m: string) => console.log(m);
  const hooks = opts.hooks ?? {};
  const termMap = hooks.termCodeToStandard ?? defaultTermCodeToStandard;
  const filterTerms = hooks.filterTerms ?? defaultFilterTerms;
  const delayMs = opts.delayMs ?? 200;

  const result: ScrapeCollegeResult = {
    slug: opts.slug,
    baseUrl: opts.baseUrl,
    totalSections: 0,
    termsScraped: [],
    errors: [],
  };

  log(`\n=== Scraping ${opts.slug} (${opts.baseUrl}) ===`);

  let allTerms: BannerTerm[];
  try {
    allTerms = await getBanner8Terms(opts.baseUrl);
  } catch (e) {
    const msg = `Could not fetch terms from ${opts.baseUrl}: ${e}`;
    log(`  ERROR: ${msg}`);
    result.errors.push(msg);
    return result;
  }

  let targetTerms: BannerTerm[];
  if (opts.termOverrides && opts.termOverrides.length > 0) {
    // Match overrides against either the code or the description
    targetTerms = opts.termOverrides
      .map((tk) => {
        const direct = allTerms.find((t) => t.code === tk);
        if (direct) return direct;
        const lc = tk.toLowerCase();
        return allTerms.find((t) => t.description.toLowerCase().includes(lc));
      })
      .filter((t): t is BannerTerm => !!t);
  } else {
    targetTerms = filterTerms(allTerms);
  }

  if (targetTerms.length === 0) {
    log(
      `  No matching terms. Available: ${allTerms.map((t) => `${t.description} (${t.code})`).join(", ")}`
    );
    return result;
  }

  log(`  Found ${targetTerms.length} target terms: ${targetTerms.map((t) => t.description).join(", ")}`);

  const outDir = path.join(process.cwd(), "data", opts.state, "courses", opts.slug);
  if (!opts.dryRun) fs.mkdirSync(outDir, { recursive: true });

  for (const term of targetTerms) {
    const standardTerm = termMap(term.code, term.description);
    log(`\n  Scraping ${term.description} (${term.code} → ${standardTerm})...`);

    let subjects: string[];
    try {
      subjects = await getBanner8Subjects(opts.baseUrl, term.code);
    } catch (e) {
      log(`    Could not fetch subject list: ${e}`);
      result.errors.push(`subjects ${term.code}: ${e}`);
      continue;
    }
    log(`    ${subjects.length} subjects`);

    const sections: CourseSection[] = [];
    for (let i = 0; i < subjects.length; i++) {
      const subj = subjects[i];
      try {
        const html = await searchBanner8(opts.baseUrl, term.code, { subject: subj });
        const parsed = parseBanner8Html(html, {
          collegeSlug: opts.slug,
          standardTerm,
          detectMode: hooks.detectMode,
        });
        if (parsed.length > 0) {
          process.stdout.write(
            `    [${i + 1}/${subjects.length}] ${subj.padEnd(5)} ${parsed.length} sections\n`
          );
        }
        sections.push(...parsed);
      } catch (e) {
        log(`    [${i + 1}/${subjects.length}] ${subj} — error: ${e}`);
      }
      if (i + 1 < subjects.length) await sleep(delayMs);
    }

    if (sections.length === 0) {
      log(`    No sections found for ${term.description}`);
      continue;
    }

    if (!opts.dryRun) {
      const outFile = path.join(outDir, `${standardTerm}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
      log(`    → ${sections.length} sections written to ${standardTerm}.json`);
    } else {
      log(`    → ${sections.length} sections (dry-run, not written)`);
    }

    result.termsScraped.push({
      code: term.code,
      description: term.description,
      standardTerm,
      sections: sections.length,
    });
    result.totalSections += sections.length;
  }

  log(`\n  ${opts.slug}: ${result.totalSections} total sections.`);
  return result;
}

export interface ScrapeBanner8ByHostOptions {
  state: string;
  hosts: Record<string, string>;
  collegeFilter?: string;
  termOverrides?: string[];
  noImport?: boolean;
  hooks?: ScraperHooks;
  delayMs?: number;
}

export interface ScrapeStateResult {
  state: string;
  results: ScrapeCollegeResult[];
  grandTotal: number;
}

export async function scrapeBanner8ByHost(
  opts: ScrapeBanner8ByHostOptions
): Promise<ScrapeStateResult> {
  const targets: Array<[string, string]> = opts.collegeFilter
    ? (() => {
        const baseUrl = opts.hosts[opts.collegeFilter];
        if (!baseUrl) {
          throw new Error(
            `Unknown college: ${opts.collegeFilter}. Known: ${Object.keys(opts.hosts).join(", ")}`
          );
        }
        return [[opts.collegeFilter, baseUrl]];
      })()
    : Object.entries(opts.hosts);

  const results: ScrapeCollegeResult[] = [];
  let grandTotal = 0;

  for (const [slug, baseUrl] of targets) {
    const r = await scrapeBanner8College({
      state: opts.state,
      slug,
      baseUrl,
      termOverrides: opts.termOverrides,
      hooks: opts.hooks,
      delayMs: opts.delayMs,
    });
    results.push(r);
    grandTotal += r.totalSections;
  }

  console.log("\n=== Summary ===");
  for (const r of results) console.log(`  ${r.slug}: ${r.totalSections} sections`);
  console.log(`  Total: ${grandTotal} sections across ${results.length} colleges`);

  if (!opts.noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("./supabase-import");
    await importCoursesToSupabase(opts.state);
  }

  return { state: opts.state, results, grandTotal };
}

// ---------------------------------------------------------------------------
// Shared-instance orchestration (one Banner 8 install hosts N colleges,
// distinguished via the sel_levl form parameter — the CCSNH/NH pattern).
// ---------------------------------------------------------------------------

export interface ScrapeBanner8SharedInstanceOptions {
  state: string;
  /** Single Banner 8 base URL shared across all colleges. */
  baseUrl: string;
  /** Map of `sel_levl` code → our college slug. */
  levelToCollege: Record<string, string>;
  /** Optional: only scrape this slug (skips other colleges on the instance). */
  collegeFilter?: string;
  termOverrides?: string[];
  noImport?: boolean;
  hooks?: ScraperHooks;
  delayMs?: number;
  /** When true, do everything except writing JSON files. Used by --smoke. */
  dryRun?: boolean;
}

/**
 * Scrape a Banner 8 instance that hosts multiple colleges via `sel_levl`.
 * Unlike per-host (which loops by subject per college), this loops by
 * level — one POST per (term × college) instead of (term × college ×
 * subject) — because shared instances tend to be smaller per-college.
 *
 * If a state needs per-subject filtering on a shared instance (rare),
 * the caller can compose `searchBanner8(...)` + `parseBanner8Html(...)`
 * directly with both `subject` and `level` set in the filter.
 */
export async function scrapeBanner8SharedInstance(
  opts: ScrapeBanner8SharedInstanceOptions
): Promise<ScrapeStateResult> {
  const hooks = opts.hooks ?? {};
  const termMap = hooks.termCodeToStandard ?? defaultTermCodeToStandard;
  const filterTerms = hooks.filterTerms ?? defaultFilterTerms;

  const targets = opts.collegeFilter
    ? Object.entries(opts.levelToCollege).filter(([, slug]) => slug === opts.collegeFilter)
    : Object.entries(opts.levelToCollege);

  if (targets.length === 0) {
    throw new Error(
      `No matching colleges. Filter=${opts.collegeFilter}; available: ${Object.values(opts.levelToCollege).join(", ")}`
    );
  }

  const allTerms = await getBanner8Terms(opts.baseUrl);
  let targetTerms: BannerTerm[];
  if (opts.termOverrides && opts.termOverrides.length > 0) {
    targetTerms = opts.termOverrides
      .map((tk) => {
        const direct = allTerms.find((t) => t.code === tk);
        if (direct) return direct;
        const lc = tk.toLowerCase();
        return allTerms.find((t) => t.description.toLowerCase().includes(lc));
      })
      .filter((t): t is BannerTerm => !!t);
  } else {
    targetTerms = filterTerms(allTerms);
  }
  if (targetTerms.length === 0) {
    console.log(
      `No matching terms. Available: ${allTerms.map((t) => `${t.description} (${t.code})`).join(", ")}`
    );
    return { state: opts.state, results: [], grandTotal: 0 };
  }

  const results: ScrapeCollegeResult[] = [];
  let grandTotal = 0;

  for (const [levelCode, slug] of targets) {
    const cresult: ScrapeCollegeResult = {
      slug,
      baseUrl: opts.baseUrl,
      totalSections: 0,
      termsScraped: [],
      errors: [],
    };
    console.log(`\n=== Scraping ${slug} (level=${levelCode}) on ${opts.baseUrl} ===`);

    const outDir = path.join(process.cwd(), "data", opts.state, "courses", slug);
    if (!opts.dryRun) fs.mkdirSync(outDir, { recursive: true });

    for (const term of targetTerms) {
      const standardTerm = termMap(term.code, term.description);
      console.log(
        `  Scraping ${term.description} (${term.code} → ${standardTerm})...`
      );
      try {
        const html = await searchBanner8(opts.baseUrl, term.code, { level: levelCode });
        const sections = parseBanner8Html(html, {
          collegeSlug: slug,
          standardTerm,
          detectMode: hooks.detectMode,
        });
        if (sections.length === 0) {
          console.log(`    No sections found.`);
          continue;
        }
        if (!opts.dryRun) {
          const outFile = path.join(outDir, `${standardTerm}.json`);
          fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
          console.log(
            `    → ${sections.length} sections written to ${standardTerm}.json`
          );
        } else {
          console.log(
            `    → ${sections.length} sections (dry-run, not written)`
          );
        }
        cresult.termsScraped.push({
          code: term.code,
          description: term.description,
          standardTerm,
          sections: sections.length,
        });
        cresult.totalSections += sections.length;
      } catch (e) {
        const msg = `${term.description}: ${e}`;
        console.log(`    Error: ${msg}`);
        cresult.errors.push(msg);
      }
      await sleep(opts.delayMs ?? 200);
    }

    results.push(cresult);
    grandTotal += cresult.totalSections;
  }

  console.log("\n=== Summary ===");
  for (const r of results) console.log(`  ${r.slug}: ${r.totalSections} sections`);
  console.log(`  Total: ${grandTotal} sections across ${results.length} colleges`);

  if (!opts.noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("./supabase-import");
    await importCoursesToSupabase(opts.state);
  }

  return { state: opts.state, results, grandTotal };
}

// ---------------------------------------------------------------------------
// CLI smoke test
// ---------------------------------------------------------------------------

interface SmokeArgs {
  url?: string;
  slug?: string;
  state?: string;
  term?: string;
  smoke: boolean;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): SmokeArgs {
  const out: SmokeArgs = { smoke: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--smoke") out.smoke = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--slug") out.slug = argv[++i];
    else if (a === "--state") out.state = argv[++i];
    else if (a === "--term") out.term = argv[++i];
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/scrape-banner-8.ts --smoke \\
    --url <baseUrl> --slug <slug> [--state <state>] [--term "Fall 2026"|<termCode>]

Smoke-test the Banner 8 template against a single host. Read-only:
no JSON files are written, no Supabase import runs.

If --term is omitted, terms auto-discover via the description-based filter.
Use a Banner term code (e.g. 202610) or a description ("Fall 2026").

Examples:
  npx tsx scripts/lib/scrape-banner-8.ts --smoke \\
    --url https://ssb.hgtc.edu/PROD9 --slug horry-georgetown --state sc \\
    --term "Summer 2026"

  npx tsx scripts/lib/scrape-banner-8.ts --smoke \\
    --url https://sis.ccsnh.edu/ssb8 --slug ccsnh --state nh
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.err) {
    if (args.err) console.error(`Error: ${args.err}`);
    printHelp();
    process.exit(args.err ? 1 : 0);
  }
  if (!args.smoke) {
    console.error("This file is a library. Add --smoke to run a read-only test.");
    printHelp();
    process.exit(1);
  }
  if (!args.url || !args.slug) {
    console.error("--smoke requires --url and --slug");
    printHelp();
    process.exit(1);
  }

  const r = await scrapeBanner8College({
    state: args.state || "smoke",
    slug: args.slug,
    baseUrl: args.url,
    termOverrides: args.term ? [args.term] : undefined,
    dryRun: true,
  });

  console.log("\n=== Smoke result ===");
  console.log(`  total sections (in-memory only): ${r.totalSections}`);
  console.log(`  terms scraped: ${r.termsScraped.length}`);
  for (const t of r.termsScraped) {
    console.log(`    ${t.standardTerm}: ${t.sections} sections (${t.description})`);
  }
  if (r.errors.length > 0) {
    console.log(`  errors:`);
    for (const e of r.errors) console.log(`    - ${e}`);
  }
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
