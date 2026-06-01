/**
 * scrape-banner-ssb.ts (template)
 *
 * Parameterized Banner SSB 9 / 10 course-section scraper. Designed to be
 * called by per-state wrappers (the auto-add-state orchestrator's path) or
 * imported directly by future per-state scripts.
 *
 * Existing per-state Banner SSB scrapers in scripts/{nj,fl,ga,ma,md,de,tn}/
 * are NOT modified by this PR — they continue producing data exactly as
 * they do today. This template is additive: it consolidates the shared 80%
 * (session init, pagination, prereq fetch, output schema) into a reusable
 * library and exposes the per-state 20% as configurable hooks.
 *
 * Usage as a library:
 *
 *   import { scrapeBannerSsbState } from "../lib/scrape-banner-ssb";
 *
 *   await scrapeBannerSsbState({
 *     state: "oh",
 *     hosts: {
 *       "tri-c":      "https://bannerssb.tri-c.edu",
 *       "lakeland":   "https://selfservice.lakelandcc.edu",
 *     },
 *   });
 *
 * Usage as a smoke test (read-only, no JSON written, no Supabase import):
 *
 *   npx tsx scripts/lib/scrape-banner-ssb.ts --smoke \
 *     --url https://bannerprod.essex.edu --slug essex
 *
 * Output schema matches the canonical Banner SSB scraper shape used across
 * the codebase (see e.g. scripts/nj/scrape-banner-ssb.ts):
 *
 *   { college_code, term, course_prefix, course_number, course_title,
 *     credits, crn, days, start_time, end_time, start_date, location,
 *     campus, mode, instructor, seats_open, seats_total,
 *     prerequisite_text, prerequisite_courses }
 */

import fs from "fs";
import path from "path";
import { pickRecentSsbTerms } from "./resolve-terms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BannerTerm {
  code: string;
  description: string;
}

/**
 * Permissive Banner section type. The Banner SSB JSON response has more
 * fields than any individual state needs; everything beyond the universally-
 * present subset is `?:` so per-state callbacks can opt in.
 */
export interface BannerSection {
  courseReferenceNumber: string;
  subject: string;
  courseNumber: string;
  courseTitle: string;
  creditHourLow: number | null;
  creditHourHigh: number | null;
  creditHours: number | null;
  campusDescription: string;
  maximumEnrollment: number;
  enrollment: number;
  seatsAvailable: number;
  scheduleTypeDescription?: string;
  instructionalMethodDescription?: string;
  faculty: { displayName: string; emailAddress?: string }[];
  meetingsFaculty: {
    meetingTime: BannerMeetingTime;
  }[];
  sectionAttributes?: { description: string }[];
}

export interface BannerMeetingTime {
  beginTime: string | null;
  endTime: string | null;
  startDate: string | null;
  endDate: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  buildingDescription: string | null;
  room: string | null;
  campusDescription: string | null;
}

export interface PrereqInfo {
  text: string;
  courses: string[];
}

export interface ConvertedSection {
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
  seats_open: number;
  seats_total: number;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

/** Per-state configurable hooks. All optional — defaults match the
 * "canonical" simple flavor used by NJ. */
export interface ScraperHooks {
  /**
   * Map a Banner term code + description to the standard `YYYYxx` form
   * (`2026FA`, `2026SP`, `2026SU`). Default reads year from description
   * and uses suffix-based fallback (10=FA, 20=SP, 30=SU). States with
   * non-standard term codes (TCSG fiscal year, DTCC's 51/52/53) override.
   */
  termCodeToStandard?: (code: string, description: string) => string;

  /** Options forwarded to pickRecentSsbTerms. */
  termPickerOptions?: Parameters<typeof pickRecentSsbTerms<BannerTerm>>[1];

  /**
   * Keep only the sections this predicate returns true for. Needed when one
   * Banner host serves multiple institutions and only some belong to this
   * college — e.g. Montana Tech's `reg-prod.ec.mtech.edu` serves both the
   * 4-year North Campus (Montana Tech) and the 2-year South Campus (Highlands
   * College, our community college), so Highlands filters to
   * `campusDescription === "South Campus"`. Omit to keep every section.
   */
  sectionFilter?: (section: BannerSection) => boolean;

  /**
   * Catalog-sourced prereq fallback merged after Banner's own prereq fetch.
   * Used by states whose Banner instances return empty prereq HTML
   * (DTCC's case — its catalog scrape lives in data/de/prereqs.json).
   */
  loadFallbackPrereqs?: () => Map<string, PrereqInfo>;

  /**
   * Normalize raw `campusDescription` to a canonical campus name. Only
   * needed when a college's Banner uses inconsistent spellings (DTCC's
   * Owens/Georgetown/Stanton/Newark/George/Wilmington pairings).
   */
  normalizeCampus?: (rawCampus: string) => string;

  /**
   * Decide section delivery mode (in-person / online / hybrid / zoom).
   * Default uses campusDescription + buildingDescription. States like DE
   * also factor in `instructionalMethodDescription`.
   */
  detectMode?: (
    section: BannerSection,
    meetingTime: BannerMeetingTime | undefined,
    rawCampus: string
  ) => string;
}

/**
 * Per-host config when the Banner SSB app is mounted at a non-standard
 * web-app context. Most institutions use the canonical
 * `/StudentRegistrationSsb` context, but some (e.g. Snow College uses
 * `/StudentRegistrationSelfService`) need this override. When you pass
 * a plain string, the default `StudentRegistrationSsb` context is used.
 */
export type BannerHostConfig = string | { baseUrl: string; appContext: string };

export interface ScrapeStateOptions {
  /** State slug — lowercase 2-letter code (used as the `data/{state}/...` directory). */
  state: string;
  /** Map of college slug → Banner SSB host config (base URL, plus app context if non-default). */
  hosts: Record<string, BannerHostConfig>;
  /** When true, only scrape this college slug; when omitted, scrape all hosts. */
  collegeFilter?: string;
  /** When true, skip the Supabase import after scraping. */
  noImport?: boolean;
  /** Per-state hook overrides. */
  hooks?: ScraperHooks;
  /**
   * When true, disable Node's TLS verification globally. Some institutional
   * Banner instances ship self-signed or expired certs; this matches the
   * existing GA scraper's escape hatch. Caller should set with caution —
   * applies to the whole process for the duration of the run.
   */
  disableTlsVerification?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;
const PREREQ_BATCH_SIZE = 10;

export function defaultTermCodeToStandard(
  code: string,
  description: string
): string {
  const descLower = description.toLowerCase();
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.substring(0, 4);

  if (descLower.includes("fall")) return `${year}FA`;
  if (descLower.includes("spring") || descLower.includes("winter")) {
    return `${year}SP`;
  }
  if (descLower.includes("summer")) return `${year}SU`;

  // Suffix fallback — common Banner convention 10=FA, 20=SP, 30=SU.
  const suffix = code.substring(4);
  if (suffix === "10") return `${year}FA`;
  if (suffix === "20") return `${year}SP`;
  if (suffix === "30") return `${year}SU`;
  return `${year}XX`;
}

export function formatTime(t: string | null): string {
  if (!t || t.length < 4) return "";
  const h = parseInt(t.substring(0, 2));
  const m = t.substring(2, 4);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}

export function buildDays(mt: BannerMeetingTime): string {
  const parts: string[] = [];
  if (mt.monday) parts.push("M");
  if (mt.tuesday) parts.push("Tu");
  if (mt.wednesday) parts.push("W");
  if (mt.thursday) parts.push("Th");
  if (mt.friday) parts.push("F");
  if (mt.saturday) parts.push("Sa");
  if (mt.sunday) parts.push("Su");
  return parts.join("");
}

export function parseDate(d: string | null): string {
  if (!d) return "";
  const parts = d.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

export function defaultDetectMode(
  section: BannerSection,
  mt: BannerMeetingTime | undefined,
  rawCampus: string
): string {
  const campusLower = (rawCampus || "").toLowerCase();
  const buildingLower = (mt?.buildingDescription || "").toLowerCase();
  const methodLower = (section.instructionalMethodDescription || "").toLowerCase();

  if (
    campusLower.includes("online") ||
    buildingLower.includes("online") ||
    buildingLower.includes("virtual") ||
    methodLower.includes("online") ||
    methodLower.includes("web")
  ) {
    return "online";
  }
  if (
    campusLower.includes("zoom") ||
    buildingLower.includes("zoom") ||
    methodLower.includes("remote") ||
    methodLower.includes("synchronous")
  ) {
    return "zoom";
  }
  if (
    campusLower.includes("hybrid") ||
    buildingLower.includes("hybrid") ||
    methodLower.includes("hybrid")
  ) {
    return "hybrid";
  }
  return "in-person";
}

// ---------------------------------------------------------------------------
// Prerequisite parsing
//
// Banner exposes prereqs through the getSectionPrerequisites endpoint as
// HTML tables (not JSON). The table has 8 columns; columns 4 and 5 hold the
// course subject + number. Column 0 is the AND/OR connector relative to
// the previous row. We map subject names back to prefixes via the
// classSearch/get_subject endpoint, which returns a per-term subject list.
// ---------------------------------------------------------------------------

export function parsePrereqHtml(
  html: string,
  subjectToPrefix: Map<string, string>
): PrereqInfo | null {
  if (html.includes("No prerequisite")) return null;

  const rows: {
    andOr: string;
    subject: string;
    courseNum: string;
    grade: string;
  }[] = [];
  const trRegex = /<tr>\s*([\s\S]*?)<\/tr>/g;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const tds: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      tds.push(tdMatch[1].trim());
    }
    if (tds.length >= 8 && (tds[4] || tds[5])) {
      rows.push({
        andOr: tds[0] || "",
        subject: tds[4],
        courseNum: tds[5],
        grade: tds[7],
      });
    }
  }

  if (rows.length === 0) return null;

  const courses: string[] = [];
  const parts: string[] = [];
  for (const row of rows) {
    const prefix = subjectToPrefix.get(row.subject.toLowerCase()) || row.subject;
    const courseCode = `${prefix} ${row.courseNum}`;
    const gradeNote =
      row.grade && row.grade !== "TR" ? ` (min ${row.grade})` : "";
    const connector = row.andOr ? ` ${row.andOr.toLowerCase()} ` : "";

    if (connector && parts.length > 0) parts.push(connector);
    parts.push(`${courseCode}${gradeNote}`);

    if (row.grade !== "TR" && !courses.includes(courseCode)) {
      courses.push(courseCode);
    }
  }

  return { text: parts.join("").trim(), courses };
}

// ---------------------------------------------------------------------------
// Banner API helpers
// ---------------------------------------------------------------------------

const DEFAULT_APP_CONTEXT = "StudentRegistrationSsb";

export async function getTerms(
  baseUrl: string,
  mepCode?: string,
  appContext: string = DEFAULT_APP_CONTEXT
): Promise<BannerTerm[]> {
  const mep = mepCode ? `&mepCode=${mepCode}` : "";
  const res = await fetch(
    `${baseUrl}/${appContext}/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30${mep}`
  );
  return res.json();
}

export async function initSession(
  baseUrl: string,
  termCode: string,
  mepCode?: string,
  appContext: string = DEFAULT_APP_CONTEXT
): Promise<string> {
  const mep = mepCode ? `?mepCode=${mepCode}` : "";
  const res1 = await fetch(
    `${baseUrl}/${appContext}/ssb/classSearch/classSearch${mep}`,
    { redirect: "manual" }
  );
  const setCookies = res1.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  const mepAmp = mepCode ? `&mepCode=${mepCode}` : "";
  await fetch(
    `${baseUrl}/${appContext}/ssb/term/search?mode=search${mepAmp}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
      },
      body: `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
    }
  );

  return cookies;
}

export async function buildSubjectMap(
  baseUrl: string,
  termCode: string,
  cookies: string,
  mepCode?: string,
  appContext: string = DEFAULT_APP_CONTEXT
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const mep = mepCode ? `&mepCode=${mepCode}` : "";
  try {
    const res = await fetch(
      `${baseUrl}/${appContext}/ssb/classSearch/get_subject?term=${termCode}&offset=1&max=500${mep}`,
      { headers: { Cookie: cookies } }
    );
    const subjects: { code: string; description: string }[] = await res.json();
    for (const s of subjects) {
      map.set(s.description.toLowerCase(), s.code);
    }
  } catch {
    // Subject map is best-effort; missing it just means prereq subject
    // names render as the long-form description rather than the prefix.
  }
  return map;
}

export async function searchSections(
  baseUrl: string,
  termCode: string,
  cookies: string,
  log?: (msg: string) => void,
  mepCode?: string,
  appContext: string = DEFAULT_APP_CONTEXT
): Promise<BannerSection[]> {
  const all: BannerSection[] = [];
  let offset = 0;
  const mep = mepCode ? `&mepCode=${mepCode}` : "";

  while (true) {
    const url = `${baseUrl}/${appContext}/ssb/searchResults/searchResults?txt_term=${termCode}&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}&sortColumn=subjectDescription&sortDirection=asc${mep}`;
    const res = await fetch(url, { headers: { Cookie: cookies } });
    const data = await res.json();

    if (!data.success || !data.data || data.data.length === 0) break;
    all.push(...data.data);
    log?.(`  fetched ${all.length}/${data.totalCount}`);

    if (all.length >= data.totalCount) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export async function fetchPrerequisites(
  baseUrl: string,
  termCode: string,
  sections: BannerSection[],
  cookies: string,
  subjectMap: Map<string, string>,
  log?: (msg: string) => void,
  mepCode?: string,
  appContext: string = DEFAULT_APP_CONTEXT
): Promise<Map<string, PrereqInfo>> {
  const courseMap = new Map<string, string>();
  for (const s of sections) {
    const key = `${s.subject} ${s.courseNumber}`;
    if (!courseMap.has(key)) courseMap.set(key, s.courseReferenceNumber);
  }

  log?.(`  Fetching prerequisites for ${courseMap.size} unique courses...`);

  const prereqs = new Map<string, PrereqInfo>();
  const entries = Array.from(courseMap.entries());
  let fetched = 0;

  for (let i = 0; i < entries.length; i += PREREQ_BATCH_SIZE) {
    const batch = entries.slice(i, i + PREREQ_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([courseKey, crn]) => {
        try {
          const res = await fetch(
            `${baseUrl}/${appContext}/ssb/searchResults/getSectionPrerequisites?term=${termCode}&courseReferenceNumber=${crn}${mepCode ? `&mepCode=${mepCode}` : ""}`,
            { headers: { Cookie: cookies } }
          );
          const html = await res.text();
          const info = parsePrereqHtml(html, subjectMap);
          return { courseKey, info };
        } catch {
          return { courseKey, info: null };
        }
      })
    );
    for (const { courseKey, info } of results) {
      if (info) prereqs.set(courseKey, info);
    }
    fetched += batch.length;
    if (fetched % 100 === 0 || fetched === entries.length) {
      log?.(`    prereqs: ${fetched}/${entries.length} (${prereqs.size} with prereqs)`);
    }
  }

  return prereqs;
}

// ---------------------------------------------------------------------------
// Section conversion (Banner → our schema)
// ---------------------------------------------------------------------------

export function convertSection(
  s: BannerSection,
  collegeSlug: string,
  standardTerm: string,
  prereq: PrereqInfo | undefined,
  hooks: ScraperHooks
): ConvertedSection {
  const mt = s.meetingsFaculty?.[0]?.meetingTime;
  const credits = s.creditHours ?? s.creditHourLow ?? 3;
  const rawCampus = mt?.campusDescription || s.campusDescription || "";
  const campus = hooks.normalizeCampus
    ? hooks.normalizeCampus(rawCampus)
    : rawCampus || "Main";
  const detect = hooks.detectMode ?? defaultDetectMode;
  const mode = mt ? detect(s, mt, rawCampus) : "online";

  return {
    college_code: collegeSlug,
    term: standardTerm,
    course_prefix: s.subject,
    course_number: s.courseNumber,
    course_title: s.courseTitle,
    credits,
    crn: s.courseReferenceNumber,
    days: mt ? buildDays(mt) : "",
    start_time: mt ? formatTime(mt.beginTime) : "",
    end_time: mt ? formatTime(mt.endTime) : "",
    start_date: mt ? parseDate(mt.startDate) : "",
    location: mt?.buildingDescription || "",
    campus,
    mode,
    instructor: s.faculty?.[0]?.displayName || null,
    seats_open: s.seatsAvailable,
    seats_total: s.maximumEnrollment,
    prerequisite_text: prereq?.text || null,
    prerequisite_courses: prereq?.courses || [],
  };
}

// ---------------------------------------------------------------------------
// Single-college scrape (no Supabase import; caller orchestrates)
// ---------------------------------------------------------------------------

export interface ScrapeCollegeResult {
  slug: string;
  baseUrl: string;
  totalSections: number;
  termsScraped: { code: string; description: string; standardTerm: string; sections: number }[];
  errors: string[];
}

export interface ScrapeCollegeOptions {
  /** State slug — used to compute the output directory `data/{state}/courses/{slug}/`. */
  state: string;
  /** College slug — used in `college_code` and the output directory. */
  slug: string;
  /** Banner SSB base URL, no trailing slash. */
  baseUrl: string;
  /** Per-state hooks. */
  hooks?: ScraperHooks;
  /** When true, do everything except writing JSON files. Used by --smoke. */
  dryRun?: boolean;
  /** When true, suppress per-term progress logging. */
  silent?: boolean;
  /**
   * Multi-institution Banner instances (e.g. Alabama's OneACCS) serve
   * multiple colleges from a single host, distinguished by a `mepCode`
   * query parameter on every API call. When set, this value is appended
   * to all Banner SSB API URLs.
   */
  mepCode?: string;
  /**
   * Web-app context path. Defaults to "StudentRegistrationSsb" (the
   * canonical Ellucian deployment). Snow College's instance is mounted
   * at "/StudentRegistrationSelfService" instead; set this to override.
   * No leading or trailing slash.
   */
  appContext?: string;
}

export async function scrapeBannerSsbCollege(
  opts: ScrapeCollegeOptions
): Promise<ScrapeCollegeResult> {
  const { state, slug, baseUrl, hooks = {}, dryRun = false, silent = false, mepCode } = opts;
  const appContext = opts.appContext ?? DEFAULT_APP_CONTEXT;
  const log = silent ? () => {} : (m: string) => console.log(m);
  const result: ScrapeCollegeResult = {
    slug,
    baseUrl,
    totalSections: 0,
    termsScraped: [],
    errors: [],
  };

  log(`\n=== Scraping ${slug} (${baseUrl}) ===`);

  let terms: BannerTerm[];
  try {
    log("  Fetching available terms...");
    terms = await getTerms(baseUrl, mepCode, appContext);
  } catch (e) {
    const msg = `Could not connect to ${baseUrl}: ${e}`;
    log(`  ERROR: ${msg}`);
    log(`  Skipping ${slug} — the Banner URL may need verification.`);
    result.errors.push(msg);
    return result;
  }

  const targetTerms = pickRecentSsbTerms(terms, hooks.termPickerOptions);

  if (targetTerms.length === 0) {
    log(
      `  No recent terms found. Available: ${terms.map((t) => `${t.description} (${t.code})`).join(", ")}`
    );
    return result;
  }

  log(
    `  Found ${targetTerms.length} target terms: ${targetTerms.map((t) => t.description).join(", ")}`
  );

  const outDir = path.join(process.cwd(), "data", state, "courses", slug);
  if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

  const fallback = hooks.loadFallbackPrereqs?.() ?? new Map<string, PrereqInfo>();
  if (fallback.size > 0) {
    log(`  Loaded ${fallback.size} catalog-fallback prereqs`);
  }

  const termMap = hooks.termCodeToStandard ?? defaultTermCodeToStandard;

  for (const term of targetTerms) {
    const standardTerm = termMap(term.code, term.description);
    log(`\n  Scraping ${term.description} (${term.code} → ${standardTerm})...`);

    try {
      const cookies = await initSession(baseUrl, term.code, mepCode, appContext);
      const subjectMap = await buildSubjectMap(baseUrl, term.code, cookies, mepCode, appContext);
      log(`  Built subject map: ${subjectMap.size} subjects`);

      const allSections = await searchSections(baseUrl, term.code, cookies, log, mepCode, appContext);
      const sections = hooks.sectionFilter
        ? allSections.filter(hooks.sectionFilter)
        : allSections;
      if (hooks.sectionFilter) {
        log(`  Filtered ${allSections.length} → ${sections.length} sections (sectionFilter)`);
      }
      if (sections.length === 0) {
        log(`  No sections found for ${term.description}`);
        continue;
      }

      const prereqs = await fetchPrerequisites(
        baseUrl,
        term.code,
        sections,
        cookies,
        subjectMap,
        log,
        mepCode,
        appContext
      );
      log(`  Found prerequisites for ${prereqs.size} courses (Banner)`);

      const converted = sections.map((s) => {
        const courseKey = `${s.subject} ${s.courseNumber}`;
        const prereq = prereqs.get(courseKey) ?? fallback.get(courseKey);
        return convertSection(s, slug, standardTerm, prereq, hooks);
      });

      if (!dryRun) {
        const outFile = path.join(outDir, `${standardTerm}.json`);
        fs.writeFileSync(outFile, JSON.stringify(converted, null, 2));
      }
      const withPrereqs = converted.filter((c) => c.prerequisite_text).length;
      log(
        `  → ${converted.length} sections${dryRun ? " (dry-run, not written)" : ` written to ${standardTerm}.json`} (${withPrereqs} with prereqs)`
      );

      result.termsScraped.push({
        code: term.code,
        description: term.description,
        standardTerm,
        sections: converted.length,
      });
      result.totalSections += converted.length;
    } catch (e) {
      const msg = `Error scraping ${term.description}: ${e}`;
      log(`  ${msg}`);
      result.errors.push(msg);
    }
  }

  log(`\n  ${slug}: ${result.totalSections} total sections scraped.`);
  return result;
}

// ---------------------------------------------------------------------------
// Multi-college orchestrator (the entry point per-state callers use)
// ---------------------------------------------------------------------------

export interface ScrapeStateResult {
  state: string;
  results: ScrapeCollegeResult[];
  grandTotal: number;
}

export async function scrapeBannerSsbState(
  opts: ScrapeStateOptions
): Promise<ScrapeStateResult> {
  if (opts.disableTlsVerification) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const normalize = (cfg: BannerHostConfig): { baseUrl: string; appContext?: string } =>
    typeof cfg === "string" ? { baseUrl: cfg } : cfg;

  const targets: Array<[string, ReturnType<typeof normalize>]> = opts.collegeFilter
    ? (() => {
        const cfg = opts.hosts[opts.collegeFilter];
        if (!cfg) {
          const known = Object.keys(opts.hosts).join(", ");
          throw new Error(
            `Unknown college: ${opts.collegeFilter}. Known: ${known}`
          );
        }
        return [[opts.collegeFilter, normalize(cfg)]];
      })()
    : Object.entries(opts.hosts).map(([slug, cfg]) => [slug, normalize(cfg)] as [string, ReturnType<typeof normalize>]);

  const results: ScrapeCollegeResult[] = [];
  let grandTotal = 0;

  for (const [slug, { baseUrl, appContext }] of targets) {
    const r = await scrapeBannerSsbCollege({
      state: opts.state,
      slug,
      baseUrl,
      appContext,
      hooks: opts.hooks,
    });
    results.push(r);
    grandTotal += r.totalSections;
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.totalSections} sections`);
  }
  console.log(
    `  Total: ${grandTotal} sections across ${results.length} colleges`
  );

  if (!opts.noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("./supabase-import");
    await importCoursesToSupabase(opts.state);
  }

  return { state: opts.state, results, grandTotal };
}

// ---------------------------------------------------------------------------
// CLI smoke test (read-only). Lets us validate the template against any
// real public Banner SSB host without touching state-specific paths or
// writing any files.
// ---------------------------------------------------------------------------

interface SmokeArgs {
  url?: string;
  slug?: string;
  state?: string;
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
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/scrape-banner-ssb.ts --smoke --url <baseUrl> --slug <slug> [--state <state>]

Smoke-test the Banner SSB template against a single public host. Read-only:
no JSON files are written and no Supabase import runs.

Examples:
  npx tsx scripts/lib/scrape-banner-ssb.ts --smoke \\
    --url https://bannerprod.essex.edu --slug essex --state nj

  npx tsx scripts/lib/scrape-banner-ssb.ts --smoke \\
    --url https://banner.aws.valenciacollege.edu --slug valencia --state fl
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

  const r = await scrapeBannerSsbCollege({
    state: args.state || "smoke",
    slug: args.slug,
    baseUrl: args.url,
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
