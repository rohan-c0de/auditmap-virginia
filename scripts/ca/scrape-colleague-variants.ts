/**
 * California — Colleague Self-Service "variant" scrape
 *
 * Three Ellucian Colleague Self-Service installs that the SHARED template at
 * scripts/lib/scrape-colleague.ts cannot drive as-is, each for a different
 * structural reason. They all share the same Colleague antiforgery handshake
 * (GET the Search page → grab the hidden `__RequestVerificationToken` input +
 * the `.ColleagueSelfServiceAntiforgery` cookie → POST search with headers
 * `__RequestVerificationToken`, `X-Requested-With: XMLHttpRequest`,
 * `__IsGuestUser: true`), but differ in app-path / request-encoding / host.
 *
 *   1) mt-san-jacinto-community-college-district
 *        base   https://selfservice.msjc.edu/css   (note the /css app context —
 *               paths are /css/Courses/... NOT /Student/Courses/...)
 *        encoding: plain PostSearchCriteria body (no Async wrapper).
 *        term codes are SEASON-FIRST: "SU26","FA26","SP27".
 *
 *   2) mendocino-college
 *        base   https://service.mendocino.edu
 *        NEWER Self-Service: the search endpoint is the *Async* variant
 *        (/Student/Courses/SearchAsync) and the body is wrapped as
 *        {"searchParameters":"<JSON-stringified criteria>"}. A Content-Length
 *        header is required or the server 411s. term codes are YEAR-FIRST:
 *        "2026FA","2026SP","2026SU".
 *
 *   3) santiago-canyon-college
 *        base   https://colss-prod.cloud.rsccd.edu   (Rancho Santiago CCD)
 *        SHARED Colleague host with Santa Ana College (already covered under
 *        the `santa-ana-college` slug elsewhere). The host returns sections for
 *        BOTH colleges; the discriminator is LocationCode: "SCC" = Santiago
 *        Canyon (KEEP), "SAC"/"CEC" = Santa Ana (DROP), "OEC" = SCC Continuing
 *        Education (dropped — we keep credit-bearing SCC only). We pass
 *        locations:["SCC"] as a server-side filter AND assert LocationCode ===
 *        "SCC" client-side as a belt-and-suspenders guard so ZERO Santa Ana
 *        rows can leak into the santiago-canyon-college output.
 *
 * Output schema is identical to every other CA course file:
 *   { college_code, term, course_prefix, course_number, course_title, credits,
 *     crn, days, start_time, end_time, start_date, location, campus, mode,
 *     instructor, seats_open, seats_total, prerequisite_text,
 *     prerequisite_courses }
 *
 * Term filenames use the canonical YEAR-FIRST code: 2026FA / 2026SP / 2026SU.
 *
 * This file is self-contained (plain fetch, no Playwright, no Supabase import).
 * It only READS scripts/lib/scrape-colleague.ts patterns; it does not import or
 * mutate the shared template.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-colleague-variants.ts                       # all 3
 *   npx tsx scripts/ca/scrape-colleague-variants.ts --college mendocino-college
 *   npx tsx scripts/ca/scrape-colleague-variants.ts --college santiago-canyon-college
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Output type (mirrors scripts/lib/scrape-colleague.ts CourseSection exactly)
// ---------------------------------------------------------------------------

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// Shape of a Colleague SectionListing "Sections[]" entry (subset we use).
interface ColleagueSection {
  Term?: { Code?: string; Description?: string };
  Course?: {
    SubjectCode?: string;
    Number?: string;
    Title?: string;
    MinimumCredits?: number | null;
    Requisites?: unknown[];
  };
  SectionNameDisplay?: string;
  FacultyDisplay?: string[];
  FormattedMeetingTimes?: Array<{
    DaysOfWeekDisplay?: string;
    StartTimeDisplay?: string;
    EndTimeDisplay?: string;
    BuildingDisplay?: string;
    RoomDisplay?: string;
    IsOnline?: boolean;
  }>;
  MeetingsDisplay?: string[];
  StartDateDisplay?: string;
  LocationDisplay?: string;
  LocationCode?: string;
  MinimumCredits?: number | null;
  Available?: number | null;
  Capacity?: number | null;
  Id?: string;
  Title?: string;
  Number?: string;
}

interface SearchResponse {
  Sections?: ColleagueSection[];
  Courses?: Array<{ MatchingSectionIds?: string[] }>;
  TotalItems?: number;
  TotalPages?: number;
  PageSize?: number;
  Subjects?: Array<{ Code?: string; Value?: string; Description?: string }>;
  TermFilters?: Array<{ Value?: string; Description?: string; Count?: number }>;
}

interface Session {
  token: string;
  cookie: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_SIZE = 500;
const HTTP_TIMEOUT_MS = 30_000;
const SUBJECT_DELAY_MS = 250;
const PAGE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Normalize "M/D/YYYY" → "YYYY-MM-DD" (already-ISO passes through). */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function formatDays(daysOfWeekDisplay: string): string {
  if (!daysOfWeekDisplay) return "";
  const spaced = daysOfWeekDisplay.replace(/\//g, " ").replace(/,\s*/g, " ").trim();
  // Colleague's DaysOfWeekDisplay uses single-letter "T" for Tuesday and "Th"
  // for Thursday. The output contract's canonical token set is
  // {M Tu W Th F Sa Su}, so map a standalone "T" → "Tu" (Th already matches and
  // is left intact). Tokens are whitespace-delimited so "Th" never gets clipped.
  return spaced
    .split(/\s+/)
    .map((tok) => (tok === "T" ? "Tu" : tok))
    .filter(Boolean)
    .join(" ");
}

function determineMode(input: {
  locationCode: string;
  locationDisplay: string;
  isOnline: boolean;
  meetingsDisplay: string[];
}): CourseMode {
  const loc = input.locationDisplay.toLowerCase();
  const allMeetings = input.meetingsDisplay.join(" ").toLowerCase();

  if (loc.includes("hybrid") || allMeetings.includes("hybrid")) return "hybrid";

  const onlineish =
    input.isOnline ||
    loc === "online" ||
    input.locationCode === "ONL" ||
    allMeetings.includes("online");
  if (onlineish) {
    if (
      allMeetings.includes("synchronous") ||
      allMeetings.includes("zoom") ||
      allMeetings.includes("teams") ||
      allMeetings.includes("remote")
    ) {
      return "zoom";
    }
    // "ANYTIME" / "Distance" with no live-meeting cue → asynchronous online.
    return "online";
  }

  if (loc.includes("virtual") && loc.includes("required")) return "zoom";
  return "in-person";
}

/**
 * Convert a Colleague term code to the canonical YEAR-FIRST filename code.
 *   "SU26" / "FA26" / "SP27"   → "2026SU" / "2026FA" / "2027SP"   (MSJC)
 *   "2026FA" / "2026SP"        → unchanged                        (Mendocino/RSCCD)
 * Returns null if the code can't be mapped to a {YYYY}{SEASON} form.
 */
function canonicalTermCode(code: string): string | null {
  const c = code.trim().toUpperCase();
  // year-first already: 2026FA, 2027SP (+ optional suffix we ignore for season)
  let m = c.match(/^(\d{4})(SP|SU|FA|WI)\b/);
  if (m) return `${m[1]}${m[2]}`;
  // season-first 2-digit year: FA26, SU26, SP27
  m = c.match(/^(SP|SU|FA|WI)(\d{2})$/);
  if (m) return `20${m[2]}${m[1]}`;
  // season-first 4-digit year: FA2026
  m = c.match(/^(SP|SU|FA|WI)(\d{4})$/);
  if (m) return `${m[2]}${m[1]}`;
  return null;
}

/** Season from a canonical code ("2026FA" → "FA"). */
function seasonOf(canonical: string): string {
  return canonical.slice(4);
}
function yearOf(canonical: string): number {
  return parseInt(canonical.slice(0, 4), 10);
}

/**
 * Decide whether a discovered term is "upcoming" (≥ the current calendar term).
 * We keep any term whose academic season is the current one or later this
 * calendar year, plus all of next year — i.e. drop only clearly-past terms.
 * Concretely: keep terms with year > thisYear, OR (year === thisYear AND season
 * ordinal >= current season ordinal). Summer that is still in its add/drop
 * window counts as current (Colleague marks it FinancialPeriod "Past" the day
 * it starts, which is too aggressive for our purposes — section data is live).
 */
function isUpcomingTerm(canonical: string): boolean {
  const order: Record<string, number> = { SP: 0, SU: 1, FA: 2, WI: 3 };
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11
  // Current season by month: Jan-May=SP, Jun-Jul=SU, Aug-Nov=FA, Dec=WI.
  let curSeason: string;
  if (month <= 4) curSeason = "SP";
  else if (month <= 6) curSeason = "SU";
  else if (month <= 10) curSeason = "FA";
  else curSeason = "WI";

  const y = yearOf(canonical);
  const s = seasonOf(canonical);
  if (y > thisYear) return true;
  if (y < thisYear) return false;
  return (order[s] ?? 0) >= (order[curSeason] ?? 0);
}

/** Map a single Colleague section JSON into our CourseSection output row. */
function mapSection(
  raw: ColleagueSection,
  slug: string,
  canonicalTerm: string
): CourseSection | null {
  const subject = raw.Course?.SubjectCode ?? "";
  const number = raw.Course?.Number ?? raw.Number ?? "";
  const title = raw.Course?.Title ?? raw.Title ?? "";
  if (!subject || !number) return null;

  const meeting = raw.FormattedMeetingTimes?.[0];
  const isOnline = meeting?.IsOnline ?? false;
  const building = meeting?.BuildingDisplay ?? "";
  const room = meeting?.RoomDisplay ?? "";
  const loc = [building, room].filter(Boolean).join(" ").trim();

  const credits =
    raw.MinimumCredits ?? raw.Course?.MinimumCredits ?? 0;

  return {
    college_code: slug,
    term: canonicalTerm,
    course_prefix: subject,
    course_number: number,
    course_title: title,
    credits: typeof credits === "number" ? credits : 0,
    crn: raw.SectionNameDisplay || raw.Id || "",
    days: formatDays(meeting?.DaysOfWeekDisplay || ""),
    start_time: meeting?.StartTimeDisplay || "",
    end_time: meeting?.EndTimeDisplay || "",
    start_date: normalizeDate(raw.StartDateDisplay || ""),
    location: loc || raw.LocationDisplay || "",
    campus: raw.LocationDisplay || "",
    mode: determineMode({
      locationCode: raw.LocationCode || "",
      locationDisplay: raw.LocationDisplay || "",
      isOnline,
      meetingsDisplay: raw.MeetingsDisplay || [],
    }),
    instructor: raw.FacultyDisplay?.length ? raw.FacultyDisplay.join(", ") : null,
    seats_open: raw.Available ?? null,
    seats_total: raw.Capacity ?? null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

/** Base Colleague search criteria object (pre-filter). */
function baseCriteria(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    subjects: [],
    synonyms: [],
    academicLevels: [],
    courseLevels: [],
    courseTypes: [],
    topicCodes: [],
    terms: [],
    days: [],
    locations: [],
    faculty: [],
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    startsAtTime: null,
    endsByTime: null,
    keyword: null,
    requirement: null,
    subrequirement: null,
    group: null,
    courseIds: null,
    sectionIds: null,
    requirementText: null,
    subRequirementText: null,
    onlineCategories: null,
    pageNumber: 1,
    quantityPerPage: PAGE_SIZE,
    openSections: null,
    openAndWaitlistedSections: null,
    keywordComponents: [],
    searchResultsView: "SectionListing",
    sortOn: "None",
    sortDirection: "Ascending",
    ...extra,
  };
}

/** GET the Search page, capture antiforgery token + cookie. */
async function openSession(base: string, searchPath: string): Promise<Session | null> {
  try {
    const res = await fetch(`${base}${searchPath}`, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (res.url.includes("/Account/Login")) return null; // SSO-walled
    const html = await res.text();
    const tokenMatch = html.match(
      /name="__RequestVerificationToken"[^>]*value="([^"]+)"/
    );
    if (!tokenMatch) return null;

    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie;
    const setCookieHeaders =
      typeof getSetCookie === "function"
        ? getSetCookie.call(res.headers)
        : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/g) ?? [];
    const cookiePairs: string[] = [];
    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(";");
      if (pair && pair.includes("=")) cookiePairs.push(pair.trim());
    }
    return { token: tokenMatch[1], cookie: cookiePairs.join("; ") };
  } catch {
    return null;
  }
}

/**
 * POST a Colleague search. `wrap` controls the newer Self-Service "Async"
 * encoding where the criteria are JSON-stringified under `searchParameters`.
 * We always send an explicit Content-Length so the Async installs that 411 on
 * a missing length are satisfied.
 */
async function postSearch(
  base: string,
  endpoint: string,
  session: Session,
  criteria: Record<string, unknown>,
  wrap: boolean
): Promise<SearchResponse | null> {
  const body = wrap
    ? JSON.stringify({ searchParameters: JSON.stringify(criteria) })
    : JSON.stringify(criteria);
  try {
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        __RequestVerificationToken: session.token,
        __IsGuestUser: "true",
        Cookie: session.cookie,
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text) as SearchResponse;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-college config
// ---------------------------------------------------------------------------

interface VariantConfig {
  slug: string;
  base: string;
  searchPath: string; // page that yields the antiforgery token
  endpoint: string; // POST search endpoint
  wrap: boolean; // Async {"searchParameters": "..."} encoding?
  /** Extra criteria merged into every search (e.g. RSCCD location filter). */
  extraCriteria?: Record<string, unknown>;
  /**
   * Client-side keep predicate (santiago-canyon drops any non-SCC section that
   * slips past the server-side location filter). Default: keep all.
   */
  keep?: (s: ColleagueSection) => boolean;
}

const VARIANTS: Record<string, VariantConfig> = {
  "mt-san-jacinto-community-college-district": {
    slug: "mt-san-jacinto-community-college-district",
    base: "https://selfservice.msjc.edu/css",
    searchPath: "/Courses/Search",
    endpoint: "/Courses/PostSearchCriteria",
    wrap: false,
  },
  "mendocino-college": {
    slug: "mendocino-college",
    base: "https://service.mendocino.edu",
    searchPath: "/Student/Courses/Search",
    endpoint: "/Student/Courses/SearchAsync",
    wrap: true,
  },
  "santiago-canyon-college": {
    slug: "santiago-canyon-college",
    base: "https://colss-prod.cloud.rsccd.edu",
    searchPath: "/Student/Courses/Search",
    endpoint: "/Student/Courses/PostSearchCriteria",
    wrap: false,
    // Server-side restrict to Santiago Canyon; client-side guard backs it up.
    extraCriteria: { locations: ["SCC"] },
    keep: (s) => (s.LocationCode || "").toUpperCase() === "SCC",
  },
};

// ---------------------------------------------------------------------------
// Discovery: terms + subjects from a single unfiltered search call
// ---------------------------------------------------------------------------

interface Discovery {
  /** native code → canonical (e.g. "FA26" → "2026FA"). */
  terms: Array<{ native: string; canonical: string }>;
  /** subject codes to iterate (the Code/Value field). */
  subjects: string[];
}

async function discover(cfg: VariantConfig, session: Session): Promise<Discovery | null> {
  const resp = await postSearch(
    cfg.base,
    cfg.endpoint,
    session,
    baseCriteria({ quantityPerPage: 1, ...(cfg.extraCriteria ?? {}) }),
    cfg.wrap
  );
  if (!resp) return null;

  const terms: Array<{ native: string; canonical: string }> = [];
  for (const tf of resp.TermFilters ?? []) {
    const native = tf.Value;
    if (!native) continue;
    const canonical = canonicalTermCode(native);
    if (!canonical) continue; // skip CONT.ED / intersession variants we can't map
    if (!isUpcomingTerm(canonical)) continue;
    if (terms.some((t) => t.canonical === canonical)) continue; // first wins
    terms.push({ native, canonical });
  }

  const subjects: string[] = [];
  for (const sub of resp.Subjects ?? []) {
    const code = sub.Code ?? sub.Value;
    if (code && !subjects.includes(code)) subjects.push(code);
  }

  return { terms, subjects };
}

// ---------------------------------------------------------------------------
// Scrape one college → write per-term JSON files
// ---------------------------------------------------------------------------

interface CollegeResult {
  slug: string;
  ok: boolean;
  reason?: string;
  perTerm: Array<{ canonical: string; count: number; path: string }>;
}

async function scrapeCollege(cfg: VariantConfig): Promise<CollegeResult> {
  const result: CollegeResult = { slug: cfg.slug, ok: false, perTerm: [] };
  console.log(`\n=== ${cfg.slug} (${cfg.base}${cfg.searchPath}) ===`);

  const session = await openSession(cfg.base, cfg.searchPath);
  if (!session) {
    result.reason = "could not open Colleague session (no token / SSO-walled / offline)";
    console.log(`  FAIL: ${result.reason}`);
    return result;
  }
  console.log("  session opened (token + cookie captured)");

  const disc = await discover(cfg, session);
  if (!disc || disc.terms.length === 0) {
    result.reason = "no upcoming terms discovered";
    console.log(`  FAIL: ${result.reason}`);
    return result;
  }
  if (disc.subjects.length === 0) {
    result.reason = "no subjects discovered";
    console.log(`  FAIL: ${result.reason}`);
    return result;
  }
  console.log(
    `  terms: ${disc.terms.map((t) => `${t.native}→${t.canonical}`).join(", ")}`
  );
  console.log(`  subjects: ${disc.subjects.length}`);

  for (const term of disc.terms) {
    const sections: CourseSection[] = [];
    const seenCrn = new Set<string>();
    let droppedNonKeep = 0;

    for (let i = 0; i < disc.subjects.length; i++) {
      const subjectCode = disc.subjects[i];
      let pageNumber = 1;
      let totalPages = 1;
      let subjectCount = 0;

      while (pageNumber <= totalPages) {
        const resp = await postSearch(
          cfg.base,
          cfg.endpoint,
          session,
          baseCriteria({
            terms: [term.native],
            subjects: [subjectCode],
            pageNumber,
            quantityPerPage: PAGE_SIZE,
            ...(cfg.extraCriteria ?? {}),
          }),
          cfg.wrap
        );
        if (!resp) break;
        if (pageNumber === 1) totalPages = resp.TotalPages || 1;

        for (const raw of resp.Sections ?? []) {
          // Term sanity: only keep sections whose own Term.Code maps to this
          // term (the search is already term-filtered, but assert anyway).
          if (raw.Term?.Code) {
            const tc = canonicalTermCode(raw.Term.Code);
            if (tc && tc !== term.canonical) continue;
          }
          if (cfg.keep && !cfg.keep(raw)) {
            droppedNonKeep++;
            continue;
          }
          const row = mapSection(raw, cfg.slug, term.canonical);
          if (!row) continue;
          // Dedupe on CRN (SectionNameDisplay) — sections can recur across
          // pagination edges or appear under multiple subject facets.
          const key = row.crn || `${row.course_prefix}-${row.course_number}-${row.start_time}-${row.days}`;
          if (seenCrn.has(key)) continue;
          seenCrn.add(key);
          sections.push(row);
          subjectCount++;
        }

        pageNumber++;
        if (pageNumber <= totalPages) await sleep(PAGE_DELAY_MS);
      }

      process.stdout.write(
        `  [${i + 1}/${disc.subjects.length}] ${subjectCode.padEnd(6)} +${subjectCount}\r`
      );
      await sleep(SUBJECT_DELAY_MS);
    }
    process.stdout.write("\n");

    if (cfg.keep) {
      console.log(`  ${term.canonical}: dropped ${droppedNonKeep} non-keep section(s)`);
    }

    if (sections.length === 0) {
      console.log(`  ${term.canonical}: 0 sections — nothing written`);
      continue;
    }

    const outDir = path.join(process.cwd(), "data", "ca", "courses", cfg.slug);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${term.canonical}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  WROTE ${sections.length} sections → ${outPath}`);
    result.perTerm.push({ canonical: term.canonical, count: sections.length, path: outPath });
  }

  result.ok = result.perTerm.length > 0;
  if (!result.ok) result.reason = "no terms produced any sections";
  return result;
}

// ---------------------------------------------------------------------------
// Verification: re-read each written file, assert schema + slug + a real row
// ---------------------------------------------------------------------------

function verifyFile(slug: string, p: string): string {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as CourseSection[];
  if (!Array.isArray(raw) || raw.length === 0) return `EMPTY ${p}`;
  const bad = raw.find(
    (r) =>
      r.college_code !== slug ||
      !r.course_prefix ||
      !r.course_number ||
      !r.crn ||
      typeof r.credits !== "number"
  );
  if (bad) return `BAD ROW in ${p}: ${JSON.stringify(bad).slice(0, 160)}`;
  if (slug === "santiago-canyon-college") {
    // No Santa Ana data may ever appear. Campus/location must not say "Santa Ana".
    const leak = raw.find((r) =>
      /santa\s*ana/i.test(`${r.campus} ${r.location}`)
    );
    if (leak) return `SANTA-ANA LEAK in ${p}: ${JSON.stringify(leak).slice(0, 160)}`;
  }
  const sample = raw[0];
  return `OK ${path.basename(p)} (${raw.length} rows) e.g. CRN ${sample.crn} ${sample.course_prefix} ${sample.course_number} "${sample.course_title}"`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { college?: string } {
  const out: { college?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--college") out.college = argv[++i];
    else if (a.startsWith("--college=")) out.college = a.split("=")[1];
  }
  return out;
}

async function main() {
  const { college } = parseArgs(process.argv.slice(2));
  let targets: VariantConfig[];
  if (college) {
    const cfg = VARIANTS[college];
    if (!cfg) {
      console.error(
        `Unknown college: ${college}. Known: ${Object.keys(VARIANTS).join(", ")}`
      );
      process.exit(1);
    }
    targets = [cfg];
  } else {
    targets = Object.values(VARIANTS);
  }

  const results: CollegeResult[] = [];
  for (const cfg of targets) {
    try {
      results.push(await scrapeCollege(cfg));
    } catch (e) {
      results.push({ slug: cfg.slug, ok: false, reason: `exception: ${e}`, perTerm: [] });
      console.error(`  EXCEPTION scraping ${cfg.slug}: ${e}`);
    }
  }

  // ---- Verification pass ----
  console.log("\n=== VERIFICATION ===");
  for (const r of results) {
    if (!r.ok) {
      console.log(`  ${r.slug}: NOT COMPLETED — ${r.reason}`);
      continue;
    }
    for (const t of r.perTerm) {
      console.log(`  ${r.slug}: ${verifyFile(r.slug, t.path)}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    if (r.ok) {
      const total = r.perTerm.reduce((a, t) => a + t.count, 0);
      console.log(
        `  ${r.slug}: ${total} sections — ${r.perTerm
          .map((t) => `${t.canonical}=${t.count}`)
          .join(", ")}`
      );
    } else {
      console.log(`  ${r.slug}: NOT COMPLETED (${r.reason})`);
    }
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
