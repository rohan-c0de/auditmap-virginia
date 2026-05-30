/**
 * scripts/ky/scrape-courses.ts
 *
 * Bespoke (not a template) scraper for the 16 KCTCS colleges in Kentucky.
 *
 * KCTCS runs a single shared PeopleSoft Campus Solutions instance. The
 * `students.kctcs.edu` PS portal itself is auth-gated (Microsoft Azure AD
 * SSO), but KCTCS exposes a public read-only class-search SPA at
 * `class-search.kctcsweb.com`, backed by a clean JSON API at
 * `/api/{terms,search,subjects,courses,formats,starts-on,campus}`.
 *
 * Why bespoke instead of a generic PeopleSoft template:
 *
 *   The fingerprint sweep (issue #289) found PeopleSoft on only 2
 *   colleges *outside* KY (1 each in OK and IL). All 16 KY colleges share
 *   one PS install with one custom-built class-search front-end. There is
 *   no portable PeopleSoft scraper waiting to emerge here — this is a
 *   one-off integration that happens to unblock 16 colleges in one move.
 *
 * Mechanics:
 *
 *   1. GET /api/terms → current/upcoming term codes (e.g. "4264" for Fall
 *      2026). Map each to project term notation ("2026FA", "2026SP",
 *      "2026SU").
 *   2. For each term, paginate through /api/search?term=<code>&page=<n>
 *      until last_page is reached. Each page returns up to 20 sections,
 *      grouped by `subject_description`.
 *   3. Each section has a `campus` code (e.g. "HEC" = Henderson, "BLC" =
 *      Bluegrass, "HZCLE" = Hazard Lees-College sub-campus). Map the
 *      campus to one of the 16 KCTCS college slugs via prefix lookup —
 *      sub-campuses (HZCLE, JFCSW, MYCLV, SECMD, etc.) all collapse onto
 *      the parent college's slug, but their human-readable campus name
 *      is preserved in the section's `campus` field.
 *   4. Transform fields to the project's `CourseSection` schema and write
 *      `data/ky/courses/{slug}/{term}.json` per (college, term).
 *
 * Usage:
 *
 *   # Scrape every published term × every KCTCS college
 *   npx tsx scripts/ky/scrape-courses.ts
 *
 *   # Single term
 *   npx tsx scripts/ky/scrape-courses.ts --term 2026FA
 *
 *   # Single college (across all terms) — useful for a smoke check
 *   npx tsx scripts/ky/scrape-courses.ts --college bluegrass-community-and-technical-college
 *
 *   # Smoke: don't write any files, just print counts
 *   npx tsx scripts/ky/scrape-courses.ts --term 2026FA --college henderson-community-college --dry-run
 *
 * Read-only against an external API. No auth, no cookies, no browser.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Public types — matches the project-wide CourseSection shape used by every
// other state's scraper output (see e.g. data/ct/courses/ct-state/2026FA.json).
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

// ---------------------------------------------------------------------------
// KCTCS API types — only the fields we actually consume. The `/api/search`
// endpoint returns ~40 fields per section; everything not listed here is
// ignored on purpose.
// ---------------------------------------------------------------------------

interface KctcsTerm {
  term_code: string;
  term_description: string;
}

interface KctcsTermsResponse {
  data: KctcsTerm[];
}

interface KctcsSection {
  id: number;
  campus: string;
  location: string;
  term_description: string;
  term_code: string;
  format: string; // INTERNET | IP | OTHER
  instruction_mode: string; // BP | BW | HB | BL | ...
  hours: string;
  subject: string;
  subject_description: string;
  title: string;
  section: string;
  number: number;
  catalog_number: string;
  meeting_pattern: string; // "MWF", "T/TH", ...
  days_meeting: string; // "Mon,Tues,Wed" — much cleaner than meeting_pattern
  instructor: string | null;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  begin_time: string;
  end_time: string;
  building_description: string;
  room: string;
  enrolled: number | null;
  max_enrollment: number | null;
  notes: string | null;
  notes_2: string | null;
}

interface KctcsSearchResponse {
  results: {
    current_page: number;
    last_page: number;
    total: number;
    // The shape of `data` depends on the back-end's grouping. In practice
    // it's an object keyed by subject_description with arrays of sections.
    data: Record<string, KctcsSection[]> | KctcsSection[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = "https://class-search.kctcsweb.com/api";
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_DELAY_MS = 400; // gentle pacing — bumped from 150ms after a 429 cut
                          // off Summer 2026 mid-pull (~13,700 Spring requests
                          // in a row tripped the rate-limit). 400ms × ~700
                          // pages = ~5 min/term, well within tolerance.
const RATE_LIMIT_BACKOFF_MS = 60_000; // 429 fallback when no Retry-After
const UA =
  "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0; +https://communitycollegepath.com)";

/**
 * KCTCS campus → college slug. Sub-campuses (Hazard Lees-College, Jefferson
 * Southwest, Maysville Licking-Valley, etc.) collapse onto the parent
 * college's slug; the section's human-readable campus name is preserved in
 * the output's `campus` field via the API's `location` value.
 *
 * Derived from a full Fall-2026 sweep (May 2026). If a new sub-campus code
 * appears later, the scraper logs it and skips that section rather than
 * guessing the wrong college — see the `unknownCampuses` block in main().
 */
const CAMPUS_TO_COLLEGE: Record<string, string> = {
  // Ashland CTC
  ACTC: "ashland-community-and-technical-college",
  // Big Sandy CTC
  BSC: "big-sandy-community-and-technical-college",
  // Bluegrass CTC
  BLC: "bluegrass-community-and-technical-college",
  // Elizabethtown CTC (main + Leitchfield + Springfield)
  ECTC: "elizabethtown-community-and-technical-college",
  ECTCL: "elizabethtown-community-and-technical-college",
  ECTCS: "elizabethtown-community-and-technical-college",
  // Gateway CTC
  GTW: "gateway-community-and-technical-college",
  // Hazard CTC (Hazard + Lewis-County + Lees + Technical)
  HZC: "hazard-community-and-technical-college",
  HZCLC: "hazard-community-and-technical-college",
  HZCLE: "hazard-community-and-technical-college",
  HZCTC: "hazard-community-and-technical-college",
  // Henderson CC
  HEC: "henderson-community-college",
  // Hopkinsville CC (main + Fort-Campbell)
  HPC: "hopkinsville-community-college",
  HPCFC: "hopkinsville-community-college",
  // Jefferson CTC (main + Bullitt + Carrollton + Southwest + Shelby + Technical)
  JFC: "jefferson-community-and-technical-college",
  JFCBC: "jefferson-community-and-technical-college",
  JFCCA: "jefferson-community-and-technical-college",
  JFCSC: "jefferson-community-and-technical-college",
  JFCSW: "jefferson-community-and-technical-college",
  JFCTC: "jefferson-community-and-technical-college",
  // Madisonville CC
  MDC: "madisonville-community-college",
  // Maysville CTC (main + Licking Valley + Montgomery + Rowan)
  MYC: "maysville-community-and-technical-college",
  MYCLV: "maysville-community-and-technical-college",
  MYCMC: "maysville-community-and-technical-college",
  MYCRC: "maysville-community-and-technical-college",
  // Owensboro CTC
  OWC: "owensboro-community-and-technical-college",
  // Somerset CC
  SMC: "somerset-community-college",
  // Southcentral KY CTC
  SKY: "southcentral-kentucky-community-and-technical-college",
  // Southeast KY CTC (main + Harlan + Knox + Middlesboro + Pineville + Whitesburg)
  SEC: "southeast-kentucky-community-and-technical-college",
  SECHA: "southeast-kentucky-community-and-technical-college",
  SECKC: "southeast-kentucky-community-and-technical-college",
  SECMD: "southeast-kentucky-community-and-technical-college",
  SECPV: "southeast-kentucky-community-and-technical-college",
  SECWH: "southeast-kentucky-community-and-technical-college",
  // West KY CTC
  WKCTC: "west-kentucky-community-and-technical-college",
};

// KCTCS day abbreviations (from the `days_meeting` field, which is way more
// regular than `meeting_pattern`) → project's single-letter / two-letter
// codes joined by space (matches the convention in scrape-banner-8.ts's
// BANNER_DAY_LETTER → "M Tu W Th F").
const DAY_ABBR: Record<string, string> = {
  Mon: "M",
  Tues: "Tu",
  Wed: "W",
  Thu: "Th",
  Fri: "F",
  Sat: "Sa",
  Sun: "Su",
};

// ---------------------------------------------------------------------------
// HTTP — fetch with timeout + JSON parse + simple retry on transient errors
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, attempt = 1): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Rate limit: honor Retry-After (seconds) if present, else use a long
    // default. Don't count 429s against the regular retry budget — they're
    // a server-side traffic-cop signal, not a transient flake.
    if (res.status === 429) {
      const ra = res.headers.get("retry-after");
      const sec = ra && /^\d+$/.test(ra) ? parseInt(ra, 10) * 1000 : RATE_LIMIT_BACKOFF_MS;
      console.warn(
        `  [429] rate-limited at ${url} — sleeping ${Math.round(sec / 1000)}s before retry`
      );
      await sleep(sec);
      return fetchJson<T>(url, attempt); // same attempt count
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (attempt < 3) {
      await sleep(500 * attempt);
      return fetchJson<T>(url, attempt + 1);
    }
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Term handling
// ---------------------------------------------------------------------------

/**
 * Map KCTCS's "Fall 2026" / "Spring 2027" / "Summer 2026" / "Winter 2026"
 * descriptions to the project's term notation. KCTCS doesn't ship
 * winter/intersession terms in the public catalog (they'd be flagged
 * "Wintersession" if they did), but we cover the case for safety.
 */
export function kctcsTermToStandard(description: string): string | null {
  const m = description.match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  const code = season.startsWith("sp")
    ? "SP"
    : season.startsWith("su")
      ? "SU"
      : season.startsWith("fa")
        ? "FA"
        : "WI";
  return `${year}${code}`;
}

export async function getKctcsTerms(): Promise<
  Array<{ termCode: string; description: string; standard: string }>
> {
  const resp = await fetchJson<KctcsTermsResponse>(`${API_BASE}/terms`);
  const out: Array<{ termCode: string; description: string; standard: string }> =
    [];
  for (const t of resp.data) {
    const std = kctcsTermToStandard(t.term_description);
    if (!std) {
      console.warn(`[ky] skipping un-recognized term: ${t.term_description}`);
      continue;
    }
    out.push({
      termCode: t.term_code,
      description: t.term_description,
      standard: std,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section transformation
// ---------------------------------------------------------------------------

function daysMeetingToStandard(daysMeeting: string): string {
  if (!daysMeeting) return "";
  return daysMeeting
    .split(",")
    .map((d) => d.trim())
    .map((d) => DAY_ABBR[d] ?? "")
    .filter(Boolean)
    .join(" ");
}

/**
 * KCTCS uses a (format, instruction_mode) pair instead of one mode field.
 * Empirical mapping from sampling Fall 2026:
 *
 *   format=IP       → in-person scheduled meetings (BP=blended-presumably-in-person)
 *   format=INTERNET → fully online (BW=blended-web)
 *   format=OTHER    → hybrid or async (HB=hybrid, BL=blended)
 *
 * If the section also has no scheduled days_meeting, treat it as online
 * regardless — that catches the OTHER+empty-days case (async online).
 */
function detectMode(s: KctcsSection): CourseMode {
  const fmt = (s.format ?? "").toUpperCase();
  const im = (s.instruction_mode ?? "").toUpperCase();
  const hasDays = (s.days_meeting ?? "").trim().length > 0;
  if (fmt === "INTERNET") return "online";
  if (fmt === "IP") return "in-person";
  if (!hasDays) return "online"; // OTHER + no schedule = async online
  if (im === "HB" || im === "BL") return "hybrid";
  return "hybrid";
}

function buildLocation(s: KctcsSection): string {
  const parts = [s.building_description, s.room, s.location]
    .map((x) => (x ?? "").trim())
    .filter(Boolean);
  return parts.join(" - ");
}

function parseCredits(raw: string): number {
  const n = parseFloat(raw ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function transformSection(
  s: KctcsSection,
  collegeSlug: string,
  termStandard: string
): CourseSection {
  return {
    college_code: collegeSlug,
    term: termStandard,
    course_prefix: (s.subject ?? "").trim(),
    course_number: (s.catalog_number ?? "").trim(),
    course_title: (s.title ?? "").trim(),
    credits: parseCredits(s.hours),
    crn: String(s.number ?? ""),
    days: daysMeetingToStandard(s.days_meeting ?? ""),
    start_time: (s.begin_time ?? "").trim(),
    end_time: (s.end_time ?? "").trim(),
    start_date: (s.starts_on ?? "").trim(),
    location: buildLocation(s),
    campus: (s.location ?? "").trim(), // KCTCS's "location" is the campus name
    mode: detectMode(s),
    instructor: (s.instructor ?? "").trim() || null,
    seats_open:
      typeof s.max_enrollment === "number" && typeof s.enrolled === "number"
        ? Math.max(0, s.max_enrollment - s.enrolled)
        : null,
    seats_total: typeof s.max_enrollment === "number" ? s.max_enrollment : null,
    prerequisite_text: null, // populated by the prereq aggregator pipeline
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Term-wide pull → grouped by college slug
// ---------------------------------------------------------------------------

interface CollegeBucket {
  slug: string;
  sections: CourseSection[];
}

interface FetchTermResult {
  termCode: string;
  termDescription: string;
  termStandard: string;
  totalSections: number;
  unknownCampuses: Map<string, number>;
  byCollege: Map<string, CollegeBucket>;
}

export async function fetchTerm(
  termCode: string,
  termDescription: string,
  termStandard: string,
  opts: { collegeFilter?: string; logEvery?: number } = {}
): Promise<FetchTermResult> {
  const byCollege = new Map<string, CollegeBucket>();
  const unknownCampuses = new Map<string, number>();
  let total = 0;

  // Initialize the page count from page 1's last_page; KCTCS's per_page is
  // fixed at 20 and there's no documented way to override.
  let page = 1;
  let lastPage = 1;
  const logEvery = opts.logEvery ?? 50;

  while (page <= lastPage) {
    const url = `${API_BASE}/search?term=${encodeURIComponent(termCode)}&page=${page}`;
    const resp = await fetchJson<KctcsSearchResponse>(url);
    lastPage = resp.results.last_page ?? 1;

    const data = resp.results.data;
    const groups: KctcsSection[][] = Array.isArray(data)
      ? [data]
      : Object.values(data);

    for (const sections of groups) {
      for (const s of sections) {
        const slug = CAMPUS_TO_COLLEGE[s.campus];
        if (!slug) {
          unknownCampuses.set(
            s.campus,
            (unknownCampuses.get(s.campus) ?? 0) + 1
          );
          continue;
        }
        if (opts.collegeFilter && slug !== opts.collegeFilter) continue;
        const bucket =
          byCollege.get(slug) ?? { slug, sections: [] as CourseSection[] };
        bucket.sections.push(transformSection(s, slug, termStandard));
        byCollege.set(slug, bucket);
        total++;
      }
    }

    if (page === 1 || page === lastPage || page % logEvery === 0) {
      console.log(
        `  [${termStandard}] page ${page}/${lastPage}, sections so far: ${total}`
      );
    }
    page++;
    if (page <= lastPage) await sleep(PAGE_DELAY_MS);
  }

  return {
    termCode,
    termDescription,
    termStandard,
    totalSections: total,
    unknownCampuses,
    byCollege,
  };
}

// ---------------------------------------------------------------------------
// Disk write
// ---------------------------------------------------------------------------

function writeBucket(bucket: CollegeBucket, termStandard: string): string {
  const dir = path.join(
    process.cwd(),
    "data",
    "ky",
    "courses",
    bucket.slug
  );
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${termStandard}.json`);
  // Sort for stable diffs: by prefix, number, section.
  bucket.sections.sort((a, b) => {
    if (a.course_prefix !== b.course_prefix)
      return a.course_prefix.localeCompare(b.course_prefix);
    if (a.course_number !== b.course_number)
      return a.course_number.localeCompare(b.course_number);
    return a.crn.localeCompare(b.crn);
  });
  fs.writeFileSync(out, JSON.stringify(bucket.sections, null, 2));
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  term?: string;
  college?: string;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--term") out.term = argv[++i];
    else if (a === "--college") out.college = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/ky/scrape-courses.ts [--term 2026FA] [--college <slug>] [--dry-run]

Options:
  --term <std>    Project term notation (e.g. 2026FA). Default: every published term.
  --college <s>   College slug to filter. Default: all 16 KCTCS colleges.
  --dry-run       Don't write JSON files; print counts only.

Examples:
  npx tsx scripts/ky/scrape-courses.ts
  npx tsx scripts/ky/scrape-courses.ts --term 2026FA
  npx tsx scripts/ky/scrape-courses.ts --term 2026FA --college henderson-community-college --dry-run
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  console.log("[ky] fetching term list…");
  const allTerms = await getKctcsTerms();
  const terms = args.term
    ? allTerms.filter((t) => t.standard === args.term)
    : allTerms;
  if (terms.length === 0) {
    console.error(
      `No matching terms. Available: ${allTerms.map((t) => t.standard).join(", ")}`
    );
    process.exit(1);
  }
  console.log(
    `[ky] terms: ${terms.map((t) => `${t.standard} (${t.termCode})`).join(", ")}`
  );

  let grandTotal = 0;
  const grandUnknown = new Map<string, number>();
  const byCollegeTotals = new Map<string, number>();

  for (const t of terms) {
    console.log(
      `\n[ky] === ${t.standard} = ${t.description} (KCTCS code ${t.termCode}) ===`
    );
    const r = await fetchTerm(t.termCode, t.description, t.standard, {
      collegeFilter: args.college,
    });
    grandTotal += r.totalSections;

    for (const [code, n] of r.unknownCampuses) {
      grandUnknown.set(code, (grandUnknown.get(code) ?? 0) + n);
    }

    for (const bucket of r.byCollege.values()) {
      byCollegeTotals.set(
        bucket.slug,
        (byCollegeTotals.get(bucket.slug) ?? 0) + bucket.sections.length
      );
      if (!args.dryRun) {
        const file = writeBucket(bucket, t.standard);
        console.log(`  wrote ${bucket.sections.length} sections → ${file}`);
      } else {
        console.log(
          `  [dry] would write ${bucket.sections.length} sections to data/ky/courses/${bucket.slug}/${t.standard}.json`
        );
      }
    }
  }

  console.log("\n=== Summary ===");
  for (const [slug, n] of [...byCollegeTotals.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    console.log(`  ${slug}: ${n} sections`);
  }
  console.log(
    `  Total: ${grandTotal} sections across ${byCollegeTotals.size} colleges`
  );
  if (grandUnknown.size > 0) {
    console.warn(
      `\n[ky] unknown campus codes (likely new sub-campuses — add to CAMPUS_TO_COLLEGE):`
    );
    for (const [code, n] of [...grandUnknown.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.warn(`  ${code}: ${n} sections skipped`);
    }
  }
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
