/**
 * scrape-sbccd.ts — San Bernardino Community College District (SBCCD)
 *
 * Two colleges share ONE public Ellucian Colleague Self-Service instance:
 *   - crafton-hills-college          → LocationCode "CHC" (+ "COFF" off-campus)
 *   - san-bernardino-valley-college  → LocationCode "SBVC" (+ "SOFF", "SBSD")
 *
 * This install's standard PostSearchCriteria endpoint 400s, so the page
 * itself drives the **SearchAsync** endpoint with a DOUBLE-WRAPPED body:
 * the criteria object is JSON.stringified and placed as the string value
 * of the key "searchParameters". We replicate that exactly.
 *
 * Pure HTTP (fetch) — no Playwright. Antiforgery handling mirrors
 * scripts/lib/colleague-terms.ts (openColleagueSession): GET the Search
 * page, scrape the hidden __RequestVerificationToken + the antiforgery
 * cookie, then send the token as the __RequestVerificationToken header
 * plus X-Requested-With + __IsGuestUser headers.
 *
 * One unfiltered paginated pass per term fetches every section; we bucket
 * each section to its owning college by LocationCode (off-campus codes
 * resolve via the district's own facet labels — "Valley Off-Campus (SBVC)"
 * → SBVC, "Crafton Off Campus (CHC)" → CHC; SBSD is a Valley program).
 *
 * Output (one file per college per term) matches the project schema exactly:
 *   data/ca/courses/<slug>/<TERM>.json
 * with TERM ∈ {2026FA, 2026SP, 2026SU}. The district returns Summer as
 * "2026SM" internally; we map it to the canonical "2026SU" filename.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-sbccd.ts                       # all colleges, all live terms
 *   npx tsx scripts/ca/scrape-sbccd.ts --college crafton-hills-college
 *   npx tsx scripts/ca/scrape-sbccd.ts --term 2026FA
 *   npx tsx scripts/ca/scrape-sbccd.ts --college san-bernardino-valley-college --term 2026FA
 *
 * No Supabase import. Idempotent: each run overwrites the target files.
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "ca";
const BASE = "https://colss-prod.ec.sbccd.edu";

// District term code → canonical filename term code. The district uses the
// Colleague-standard "SM" for Summer; the project filename convention is "SU".
const DISTRICT_TERMS: Record<string, string> = {
  "2026FA": "2026FA",
  "2026SP": "2026SP",
  "2026SM": "2026SU",
};

// LocationCode → owning college slug. Off-campus codes resolve to their
// parent college per the district's own facet labels (verified live).
const LOCATION_TO_COLLEGE: Record<string, string> = {
  CHC: "crafton-hills-college",
  COFF: "crafton-hills-college",
  SBVC: "san-bernardino-valley-college",
  SOFF: "san-bernardino-valley-college",
  SBSD: "san-bernardino-valley-college",
};

const COLLEGE_CAMPUS_NAME: Record<string, string> = {
  "crafton-hills-college": "Crafton Hills College",
  "san-bernardino-valley-college": "San Bernardino Valley College",
};

const ALL_SLUGS = [
  "crafton-hills-college",
  "san-bernardino-valley-college",
];

const DELAY_MS = 400;
const PREREQ_BATCH_SIZE = 10;
const PREREQ_BATCH_DELAY_MS = 150;

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

interface ColleagueSession {
  cookie: string;
  token: string;
}

interface RawMeeting {
  DaysOfWeekDisplay?: string;
  StartTimeDisplay?: string;
  EndTimeDisplay?: string;
  BuildingDisplay?: string;
  RoomDisplay?: string;
  IsOnline?: boolean;
  InstructionalMethodDisplay?: string;
}

interface RawCourse {
  SubjectCode?: string;
  Number?: string;
  Title?: string;
  MinimumCredits?: number;
}

interface RawSection {
  Term?: { Code?: string };
  TermId?: string;
  Course?: RawCourse;
  CourseName?: string;
  Number?: string;
  Title?: string;
  Synonym?: string;
  Id?: string;
  MinimumCredits?: number;
  FacultyDisplay?: string[];
  StartDateDisplay?: string;
  LocationDisplay?: string;
  LocationCode?: string;
  Available?: number | null;
  Capacity?: number | null;
  InstructionalMethodsDisplay?: string[];
  MeetingsDisplay?: string[];
  FormattedMeetingTimes?: RawMeeting[];
}

interface SearchResponse {
  Sections?: RawSection[];
  TotalItems?: number;
  TotalPages?: number;
  PageSize?: number;
  TermFilters?: Array<{ Value: string; Description: string; Count: number }>;
  ErrorMessage?: string | null;
}

interface RequisiteItem {
  DisplayText?: string;
  IsRequired?: boolean;
}

interface SectionDetailsResponse {
  RequisiteItems?: RequisiteItem[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const UA = "CommunityCollegePath/1.0";

/**
 * Prime a session: GET the Search page, capture the antiforgery cookie and
 * the hidden __RequestVerificationToken. Mirrors colleague-terms.ts.
 */
async function openSession(): Promise<ColleagueSession | null> {
  const res = await fetch(
    `${BASE}/Student/Courses/Search?searchResultsView=SectionListing`,
    {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!res.ok) {
    console.error(`  Session GET failed: HTTP ${res.status}`);
    return null;
  }
  const html = await res.text();
  const tokenMatch = html.match(
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/
  );
  if (!tokenMatch) {
    console.error("  Could not find __RequestVerificationToken on Search page");
    return null;
  }

  const setCookieHeaders =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/g) ?? [];

  const cookiePairs: string[] = [];
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(";");
    if (pair && pair.includes("=")) cookiePairs.push(pair.trim());
  }

  return { cookie: cookiePairs.join("; "), token: tokenMatch[1] };
}

/** POST a search criteria object to SearchAsync with the double-wrapped body. */
async function searchAsync(
  session: ColleagueSession,
  criteria: Record<string, unknown>
): Promise<SearchResponse | null> {
  try {
    const res = await fetch(
      `${BASE}/Student/Courses/SearchAsync?searchResultsView=SectionListing`,
      {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json; charset=UTF-8",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          __RequestVerificationToken: session.token,
          __IsGuestUser: "true",
          Cookie: session.cookie,
        },
        // DOUBLE-WRAP: criteria is JSON.stringified into the "searchParameters" value.
        body: JSON.stringify({ searchParameters: JSON.stringify(criteria) }),
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as SearchResponse;
  } catch {
    return null;
  }
}

/** Fetch a single section's details (for prerequisite RequisiteItems). */
async function fetchSectionDetails(
  session: ColleagueSession,
  sectionId: string
): Promise<SectionDetailsResponse | null> {
  try {
    const res = await fetch(`${BASE}/Student/Courses/SectionDetails`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        __RequestVerificationToken: session.token,
        __IsGuestUser: "true",
        Cookie: session.cookie,
      },
      body: JSON.stringify({ sectionId }),
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return (await res.json()) as SectionDetailsResponse;
  } catch {
    return null;
  }
}

function buildCriteria(termCode: string, pageNumber: number): Record<string, unknown> {
  return {
    keyword: null,
    subjects: [],
    synonyms: [],
    academicLevels: [],
    courseLevels: [],
    courseTypes: [],
    topicCodes: [],
    terms: [termCode],
    days: [],
    locations: [],
    faculty: [],
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    startsAtTime: null,
    endsByTime: null,
    keyword2: null,
    requirement: null,
    subrequirement: null,
    group: null,
    courseIds: null,
    sectionIds: null,
    requirementText: null,
    subRequirementText: null,
    onlineCategories: null,
    openSections: null,
    openAndWaitlistedSections: null,
    keywordComponents: [],
    pageNumber,
    quantityPerPage: 30,
    searchResultsView: "SectionListing",
    sortOn: "SectionName",
    sortDirection: "Ascending",
  };
}

/** Discover which district terms currently have live sections posted. */
async function discoverTerms(session: ColleagueSession): Promise<string[]> {
  const probe = await searchAsync(session, buildCriteria("", 1));
  if (!probe?.TermFilters || probe.TermFilters.length === 0) {
    // Fall back to the known district terms if the facet is missing.
    return Object.keys(DISTRICT_TERMS);
  }
  return probe.TermFilters.filter((t) => t.Count > 0).map((t) => t.Value);
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * SBCCD's DaysOfWeekDisplay returns space/comma/slash-separated tokens
 * "M T W Th F Sa Su" — note Tuesday is "T" (not "Tu") while Thursday is
 * already "Th". The project contract uses "M Tu W Th F Sa Su", so map the
 * lone "T" → "Tu" and pass the rest through.
 */
const DAY_TOKEN_MAP: Record<string, string> = {
  M: "M",
  T: "Tu",
  Tu: "Tu",
  W: "W",
  Th: "Th",
  F: "F",
  Sa: "Sa",
  Su: "Su",
};

function formatDays(daysOfWeekDisplay: string): string {
  if (!daysOfWeekDisplay) return "";
  return daysOfWeekDisplay
    .split(/[\s,/]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => DAY_TOKEN_MAP[t] ?? t)
    .join(" ")
    .trim();
}

/**
 * Determine delivery mode from SBCCD's instructional-method labels.
 *   Lecture / Laboratory                 → in-person
 *   Internet-Based - Delayed-Intr        → online (asynchronous)
 *   Internet-Based - SimIntrct           → zoom (synchronous online)
 *   SimInt, 2-way Video & Audio          → zoom (synchronous, remote)
 * A section combining an online method with an in-person meeting is hybrid.
 */
function determineMode(section: RawSection): CourseMode {
  const methods = (section.InstructionalMethodsDisplay || []).map((m) =>
    m.toLowerCase()
  );
  const meetings = section.FormattedMeetingTimes || [];
  const hasInPersonMeeting = meetings.some(
    (m) => !m.IsOnline && (m.StartTimeDisplay || m.BuildingDisplay || m.RoomDisplay)
  );

  const isOnlineMethod = (m: string) =>
    m.includes("internet-based") ||
    m.includes("online") ||
    m.includes("simint") ||
    m.includes("2-way video");
  const isSyncMethod = (m: string) =>
    m.includes("simintrct") ||
    m.includes("simint") ||
    m.includes("2-way video") ||
    m.includes("simulta");

  const anyOnline = methods.some(isOnlineMethod);
  const anySync = methods.some(isSyncMethod);
  const anyInPersonMethod = methods.some(
    (m) => m.includes("lecture") || m.includes("laborator") || m.includes("activity") || m.includes("clinic")
  );

  // Mixed delivery: online method AND a genuine on-campus meeting.
  if (anyOnline && (hasInPersonMeeting || (anyInPersonMethod && !anySync && hasInPersonMeeting))) {
    return "hybrid";
  }

  if (anyOnline) {
    return anySync ? "zoom" : "online";
  }

  return "in-person";
}

/**
 * Parse SBCCD requisite DisplayText into canonical text + course codes.
 * SBCCD course codes appear as "ENGL C1000", "MATH 102", "BIOL-104" — i.e.
 * a 2-5 char subject followed by a section/course number that may carry a
 * leading letter (C1000) and a trailing letter (102H). We keep the prose
 * text (often "PREREQUISITE: ..." placement guidance) and pull any codes.
 */
function parseRequisites(items: RequisiteItem[]): {
  text: string | null;
  courses: string[];
} {
  const requiredTexts: string[] = [];
  const courses: string[] = [];
  const seenCourse = new Set<string>();

  for (const item of items) {
    if (!item?.DisplayText) continue;
    if (item.IsRequired === false) continue; // skip recommendations
    const dt = item.DisplayText.trim();
    requiredTexts.push(dt);

    // Subject (2-5 uppercase) + space/hyphen + optional letter + 1-4 digits + optional trailing letter.
    const re = /\b([A-Z]{2,5})[-\s]([A-Z]?\d{1,4}[A-Z]?)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(dt)) !== null) {
      const subj = m[1];
      const num = m[2];
      // Filter obvious non-course tokens (e.g. "GPA 2", "OF 12") by requiring
      // the number portion to contain a digit run typical of course numbers.
      if (!/\d/.test(num)) continue;
      const code = `${subj} ${num}`;
      if (!seenCourse.has(code)) {
        seenCourse.add(code);
        courses.push(code);
      }
    }
  }

  if (requiredTexts.length === 0) return { text: null, courses: [] };
  // Dedupe identical prose lines.
  const uniqueTexts = Array.from(new Set(requiredTexts));
  return { text: uniqueTexts.join(" "), courses };
}

interface PageOutcome {
  sectionsByCollege: Map<string, CourseSection[]>;
  // courseKey -> a representative sectionId for prereq lookup, plus the colleges/sections it appears in
  requisiteLookup: Map<string, string>;
}

function emptyOutcome(): PageOutcome {
  return { sectionsByCollege: new Map(), requisiteLookup: new Map() };
}

/** Scrape every section of one district term, bucketed by owning college. */
async function scrapeTerm(
  session: ColleagueSession,
  districtTermCode: string
): Promise<PageOutcome | null> {
  const fileTerm = DISTRICT_TERMS[districtTermCode] || districtTermCode;
  console.log(`\n=== Term ${districtTermCode} (file: ${fileTerm}) ===`);

  const first = await searchAsync(session, buildCriteria(districtTermCode, 1));
  if (!first) {
    console.error(`  Term ${districtTermCode}: initial search failed`);
    return null;
  }
  const totalPages = first.TotalPages || 1;
  const totalItems = first.TotalItems || 0;
  console.log(`  ${totalItems} sections across ${totalPages} pages`);

  const outcome = emptyOutcome();
  // course "SUBJ NUM" key -> sectionId, to fetch prereqs once per course.
  const courseToSectionId = new Map<string, string>();

  const ingest = (sections: RawSection[]) => {
    for (const s of sections) {
      const locCode = s.LocationCode || "";
      const slug = LOCATION_TO_COLLEGE[locCode];
      if (!slug) {
        // Unknown location — attribute nowhere rather than guess.
        continue;
      }

      const meeting = (s.FormattedMeetingTimes || [])[0];
      const prefix = s.Course?.SubjectCode || (s.CourseName || "").split("-")[0] || "";
      const number = s.Course?.Number || "";
      if (!prefix || !number) continue;

      const credits =
        typeof s.MinimumCredits === "number"
          ? s.MinimumCredits
          : typeof s.Course?.MinimumCredits === "number"
          ? s.Course.MinimumCredits
          : 0;

      const section: CourseSection = {
        college_code: slug,
        term: fileTerm,
        course_prefix: prefix,
        course_number: number,
        course_title: s.Course?.Title || s.Title || "",
        credits,
        crn: s.Synonym || s.Id || "",
        days: formatDays(meeting?.DaysOfWeekDisplay || ""),
        start_time: meeting?.StartTimeDisplay || "",
        end_time: meeting?.EndTimeDisplay || "",
        start_date: normalizeDate(s.StartDateDisplay || ""),
        location:
          [meeting?.BuildingDisplay, meeting?.RoomDisplay]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim() || s.LocationDisplay || "",
        campus: COLLEGE_CAMPUS_NAME[slug] || s.LocationDisplay || "",
        mode: determineMode(s),
        instructor:
          s.FacultyDisplay && s.FacultyDisplay.length > 0
            ? s.FacultyDisplay.join(", ")
            : null,
        seats_open: typeof s.Available === "number" ? s.Available : null,
        seats_total: typeof s.Capacity === "number" ? s.Capacity : null,
        prerequisite_text: null,
        prerequisite_courses: [],
      };

      if (!outcome.sectionsByCollege.has(slug)) {
        outcome.sectionsByCollege.set(slug, []);
      }
      outcome.sectionsByCollege.get(slug)!.push(section);

      const courseKey = `${prefix} ${number}`;
      if (s.Id && !courseToSectionId.has(courseKey)) {
        courseToSectionId.set(courseKey, s.Id);
      }
    }
  };

  ingest(first.Sections || []);

  for (let p = 2; p <= totalPages; p++) {
    const resp = await searchAsync(session, buildCriteria(districtTermCode, p));
    if (!resp || !resp.Sections) {
      console.error(`  page ${p}/${totalPages} failed; retrying once`);
      await sleep(1000);
      const retry = await searchAsync(session, buildCriteria(districtTermCode, p));
      if (!retry || !retry.Sections) {
        console.error(`  page ${p}/${totalPages} failed again; aborting term to avoid partial file`);
        return null;
      }
      ingest(retry.Sections);
    } else {
      ingest(resp.Sections);
    }
    if (p % 20 === 0 || p === totalPages) {
      const got = Array.from(outcome.sectionsByCollege.values()).reduce(
        (a, v) => a + v.length,
        0
      );
      console.log(`  page ${p}/${totalPages} — ${got} sections so far`);
    }
    await sleep(DELAY_MS);
  }

  outcome.requisiteLookup = courseToSectionId;
  return outcome;
}

/**
 * Enrich sections with prerequisites. Fetch SectionDetails once per unique
 * course, parse RequisiteItems, then map back onto every section of that
 * course across both colleges.
 */
async function enrichPrereqs(
  session: ColleagueSession,
  outcome: PageOutcome
): Promise<void> {
  const courseEntries = Array.from(outcome.requisiteLookup.entries());
  if (courseEntries.length === 0) return;
  console.log(`  Fetching prerequisites for ${courseEntries.length} unique courses...`);

  const prereqByCourse = new Map<string, { text: string | null; courses: string[] }>();
  let done = 0;

  for (let i = 0; i < courseEntries.length; i += PREREQ_BATCH_SIZE) {
    const batch = courseEntries.slice(i, i + PREREQ_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([courseKey, sectionId]) => {
        const detail = await fetchSectionDetails(session, sectionId);
        return { courseKey, items: detail?.RequisiteItems || [] };
      })
    );
    for (const { courseKey, items } of results) {
      const parsed = parseRequisites(items);
      if (parsed.text) prereqByCourse.set(courseKey, parsed);
    }
    done += batch.length;
    if (done % 100 === 0 || done === courseEntries.length) {
      console.log(`    prereqs: ${done}/${courseEntries.length} (${prereqByCourse.size} with required prereqs)`);
    }
    if (i + PREREQ_BATCH_SIZE < courseEntries.length) await sleep(PREREQ_BATCH_DELAY_MS);
  }

  for (const sections of Array.from(outcome.sectionsByCollege.values())) {
    for (const section of sections) {
      const key = `${section.course_prefix} ${section.course_number}`;
      const prereq = prereqByCourse.get(key);
      if (prereq) {
        section.prerequisite_text = prereq.text;
        section.prerequisite_courses = prereq.courses;
      }
    }
  }
  console.log(`  Applied prereqs to ${prereqByCourse.size} courses`);
}

function writeCollegeTerm(
  slug: string,
  fileTerm: string,
  sections: CourseSection[]
): string {
  const outDir = path.join(process.cwd(), "data", STATE, "courses", slug);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${fileTerm}.json`);
  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
  return outPath;
}

interface Args {
  college?: string;
  term?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--college") out.college = argv[++i];
    else if (a === "--term") out.term = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targetSlugs = args.college ? [args.college] : ALL_SLUGS;
  for (const slug of targetSlugs) {
    if (!ALL_SLUGS.includes(slug)) {
      console.error(`Unknown college: ${slug}. Known: ${ALL_SLUGS.join(", ")}`);
      process.exit(1);
    }
  }

  console.log("Opening SBCCD Colleague session...");
  const session = await openSession();
  if (!session) {
    console.error("FATAL: could not open session (no token/cookie). Nothing written.");
    process.exit(1);
  }
  console.log("  Got antiforgery token + cookie.");

  // Resolve target district terms.
  let districtTerms: string[];
  if (args.term) {
    // Accept either a file term (2026SU) or a district term (2026SM).
    const reverse: Record<string, string> = {};
    for (const [d, f] of Object.entries(DISTRICT_TERMS)) reverse[f] = d;
    const districtCode = DISTRICT_TERMS[args.term]
      ? args.term // already a district code
      : reverse[args.term];
    if (!districtCode) {
      console.error(
        `Unknown term: ${args.term}. Valid: ${Object.keys(DISTRICT_TERMS).join(", ")} (district) or ${Object.values(DISTRICT_TERMS).join(", ")} (file).`
      );
      process.exit(1);
    }
    districtTerms = [districtCode];
  } else {
    districtTerms = await discoverTerms(session);
    console.log(`Discovered live terms: ${districtTerms.join(", ")}`);
  }

  const summary: { slug: string; term: string; count: number; sample: CourseSection | null }[] = [];

  for (const districtTerm of districtTerms) {
    const fileTerm = DISTRICT_TERMS[districtTerm] || districtTerm;
    const outcome = await scrapeTerm(session, districtTerm);
    if (!outcome) {
      console.error(`  Term ${districtTerm} failed — writing nothing for this term.`);
      continue;
    }

    await enrichPrereqs(session, outcome);

    for (const slug of targetSlugs) {
      const sections = outcome.sectionsByCollege.get(slug) || [];
      if (sections.length === 0) {
        console.log(`  ${slug} / ${fileTerm}: 0 sections — writing nothing.`);
        continue;
      }
      // Stable ordering: by course, then section name (crn).
      sections.sort((a, b) => {
        const ck = `${a.course_prefix} ${a.course_number}`.localeCompare(
          `${b.course_prefix} ${b.course_number}`
        );
        return ck !== 0 ? ck : a.crn.localeCompare(b.crn);
      });
      const outPath = writeCollegeTerm(slug, fileTerm, sections);
      console.log(`  Wrote ${sections.length} sections → ${outPath}`);
      summary.push({ slug, term: fileTerm, count: sections.length, sample: sections[0] });
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const s of summary) {
    console.log(`  ${s.slug} / ${s.term}: ${s.count} sections`);
    if (s.sample) {
      console.log(
        `    sample: ${s.sample.course_prefix} ${s.sample.course_number} "${s.sample.course_title}" crn=${s.sample.crn} mode=${s.sample.mode} campus=${s.sample.campus}`
      );
    }
  }
  if (summary.length === 0) {
    console.log("  (nothing written)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
