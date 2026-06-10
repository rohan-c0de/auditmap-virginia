/**
 * scrape-canyons.ts — College of the Canyons (Santa Clarita CCD) course-section scraper
 *
 * College of the Canyons runs Ellucian Colleague Self-Service at
 *   https://selfservice.canyons.edu
 * with anonymous (no-login) access to the course-search path. The shared
 * Colleague template (scripts/lib/scrape-colleague.ts) SKIPS this college
 * because its automatic term discovery fails here: the generic
 * PostSearchCriteria probe returns an empty `ActivePlanTerms`, so
 * resolveCollegeTerms() yields zero terms and the template bails.
 *
 * This standalone scraper drives the site directly with plain fetch (no
 * Playwright). The crux — term discovery — is solved by reading the
 * `Terms` tuples out of the GetCatalogAdvancedSearch endpoint instead of
 * relying on ActivePlanTerms:
 *
 *   GET /Student/Courses/GetCatalogAdvancedSearch
 *       (with __RequestVerificationToken header + antiforgery cookie)
 *   → { Terms: [ {Item1:"2026FA", Item2:"Fall 2026"}, ... ],
 *       Subjects: [ {Code:"BIOSCI", Description:"Biological Science"}, ... ],
 *       ... }
 *
 * Verified live (2026-06-09): three upcoming terms exposed —
 *   2026SP "Spring 2026", 2026SU "Summer 2026", 2026FA "Fall 2026"
 * and 144 subjects (Canyons uses NON-STANDARD codes — BIOSCI not BIOL,
 * ENGL, ADMJUS, NC.* non-credit prefixes, etc.). We enumerate the actual
 * subject list rather than assuming anything.
 *
 * Per term, per subject we POST /Student/Courses/PostSearchCriteria
 * (paginated at 30 sections/page) to collect sections, then enrich
 * prerequisites by POSTing /Student/Courses/SectionDetails for each unique
 * course that declares a *required* requisite.
 *
 * Session: every POST/authenticated-GET needs the antiforgery cookie
 * (.ColleagueSelfServiceAntiforgery) AND the matching hidden
 * __RequestVerificationToken sent as the __RequestVerificationToken header,
 * plus X-Requested-With: XMLHttpRequest and __IsGuestUser: true. The cookie
 * + token are minted together by GETting the Search page; we re-prime them
 * periodically because they expire over a long run.
 *
 * Output schema matches every other Community College Path course file
 * exactly (data/ca/courses/college-of-the-canyons/<TERM>.json):
 *   { college_code, term, course_prefix, course_number, course_title,
 *     credits, crn, days, start_time, end_time, start_date, location,
 *     campus, mode, instructor, seats_open, seats_total,
 *     prerequisite_text, prerequisite_courses }
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-canyons.ts                 # all exposed terms
 *   npx tsx scripts/ca/scrape-canyons.ts --term 2026FA   # one term (code)
 *   npx tsx scripts/ca/scrape-canyons.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-canyons.ts --term 2026FA,2026SP
 *   npx tsx scripts/ca/scrape-canyons.ts --subject BIOSCI   # debug one subject
 *   npx tsx scripts/ca/scrape-canyons.ts --dry-run          # no files written
 *
 * No Supabase import. Idempotent — re-running a term overwrites its file.
 * Never fabricates: if the live source yields zero sections for a term, no
 * file is written for that term.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://selfservice.canyons.edu";
const COLLEGE_CODE = "college-of-the-canyons";
const STATE = "ca";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HTTP_TIMEOUT_MS = 60_000;
const PAGE_DELAY_MS = 150;
const SUBJECT_DELAY_MS = 250;
const PREREQ_BATCH_SIZE = 8;
const PREREQ_BATCH_DELAY_MS = 200;
// Re-prime the antiforgery session every N requests so a long run doesn't
// die on an expired token mid-stream.
const SESSION_REFRESH_EVERY = 200;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Types
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

interface Session {
  cookie: string;
  token: string;
  requestCount: number;
}

interface TermTuple {
  code: string; // "2026FA"
  description: string; // "Fall 2026"
}

interface SubjectInfo {
  Code: string;
  Description: string;
  ShowInCourseSearch?: boolean;
}

interface CatalogAdvancedSearch {
  Subjects?: SubjectInfo[];
  Terms?: Array<{ Item1?: string; Item2?: string }>;
}

interface FormattedMeetingTime {
  DaysOfWeekDisplay?: string;
  StartTimeDisplay?: string;
  EndTimeDisplay?: string;
  BuildingDisplay?: string;
  RoomDisplay?: string;
  InstructionalMethodDisplay?: string;
  Days?: number[];
  IsOnline?: boolean;
}

interface ColleagueSection {
  Id: string;
  Synonym?: string;
  Number?: string;
  SectionNameDisplay?: string;
  CourseName?: string;
  Title?: string;
  Course?: {
    SubjectCode?: string;
    Number?: string;
    Title?: string;
    MinimumCredits?: number;
    Requisites?: Array<{ IsRequired?: boolean }>;
  };
  MinimumCredits?: number;
  FacultyDisplay?: string[];
  FormattedMeetingTimes?: FormattedMeetingTime[];
  MeetingsDisplay?: string[];
  InstructionalMethodsDisplay?: string[];
  Comments?: string;
  StartDateDisplay?: string;
  LocationDisplay?: string;
  LocationCode?: string;
  Available?: number | null;
  Capacity?: number | null;
  AreSeatCountsAvailable?: boolean;
}

interface SearchResponse {
  Sections?: ColleagueSection[];
  TotalItems?: number;
  TotalPages?: number;
  PageSize?: number;
}

interface RequisiteItem {
  DisplayText?: string;
  IsRequired?: boolean;
}

interface SectionDetailsResponse {
  RequisiteItems?: RequisiteItem[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "8/24/2026" → "2026-08-24"; passes through already-ISO dates. */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// Colleague's numeric Days array: 0=Sun .. 6=Sat (verified live: M/W→[1,3],
// T/Th→[2,4]). Map to the canonical M Tu W Th F Sa Su tokens.
const NUM_TO_TOKEN = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];

// Fallback when only DaysOfWeekDisplay ("M/W", "T/Th") is present. Canyons
// uses T for Tuesday and Th for Thursday, S for Saturday, Su for Sunday.
const DISPLAY_TO_TOKEN: Record<string, string> = {
  M: "M",
  T: "Tu",
  TU: "Tu",
  W: "W",
  TH: "Th",
  F: "F",
  S: "Sa",
  SA: "Sa",
  SU: "Su",
  SUN: "Su",
};

function daysFromMeeting(m: FormattedMeetingTime | undefined): string {
  if (!m) return "";
  if (Array.isArray(m.Days) && m.Days.length > 0) {
    const toks = m.Days.map((n) => NUM_TO_TOKEN[n]).filter(Boolean);
    if (toks.length > 0) return toks.join(" ");
  }
  const disp = (m.DaysOfWeekDisplay || "").trim();
  if (!disp) return "";
  const toks = disp
    .split(/[\/,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => DISPLAY_TO_TOKEN[s.toUpperCase()] || "")
    .filter(Boolean);
  return toks.join(" ");
}

/**
 * Determine in-person / online / hybrid / zoom from a section's
 * instructional methods, online flags, location, and comments. Canyons
 * encodes the modality in InstructionalMethodsDisplay strings such as
 * "Lect/Disc - 100% Online", "Lect/Disc - Hybrid", "Lecture And/Or
 * Discussion", "Laboratory/Studio/Activity", and in free-text Comments
 * ("HYBRID.", "This is a fully online class", "synchronous", "Zoom").
 */
function determineMode(s: ColleagueSection): CourseMode {
  const methods = (s.InstructionalMethodsDisplay || []).join(" ").toLowerCase();
  const comments = (s.Comments || "").toLowerCase();
  const loc = (s.LocationDisplay || "").toLowerCase();
  const meetings = s.FormattedMeetingTimes || [];
  const blob = `${methods} ${comments}`;

  const isSync =
    blob.includes("synchronous") ||
    blob.includes("zoom") ||
    blob.includes("real-time") ||
    blob.includes("real time") ||
    /\bremote\b/.test(blob);

  // Hybrid: explicit method/comment, OR mixed online + in-person meetings.
  const hasOnlineMeeting = meetings.some((m) => m.IsOnline);
  const hasInPersonMeeting = meetings.some(
    (m) => !m.IsOnline && (m.BuildingDisplay || m.RoomDisplay)
  );
  if (
    methods.includes("hybrid") ||
    /\bhybrid\b/.test(comments) ||
    (hasOnlineMeeting && hasInPersonMeeting)
  ) {
    // A hybrid with a synchronous online component is still "hybrid" — the
    // in-person meeting dominates the categorization for planning.
    return "hybrid";
  }

  // Fully online (no in-person meeting at all).
  const allOnline =
    meetings.length > 0 && meetings.every((m) => m.IsOnline);
  if (
    allOnline ||
    methods.includes("100% online") ||
    methods.includes("online") ||
    loc === "online" ||
    s.LocationCode === "ONL"
  ) {
    return isSync ? "zoom" : "online";
  }

  if (isSync && meetings.length === 0) return "zoom";
  return "in-person";
}

/**
 * Parse Colleague RequisiteItems[] DisplayText into canonical text + course
 * list. Canyons-specific: codes are hyphen-joined and the number part may be
 * prefixed with a letter (e.g. "STAT-C1000", "STAT-C1000E", "MATH-140H",
 * "BIOSCI-100", "ENGL-101"). The shared template's regex
 * (`[A-Z]{2,4}[-* ]\d{3,4}`) misses both the 6-char "BIOSCI" prefix and the
 * "C1000" letter-led number, so we use a Canyons-tuned pattern.
 *
 * Only requisites flagged required (or where the item doesn't say
 * "recommended"/"not required") are emitted as prerequisites — Canyons marks
 * advisory items with IsRequired:false and DisplayTextExtension text like
 * "Recommended prior to taking this course, but is not required."
 */
function parseRequisites(items: RequisiteItem[]): {
  text: string | null;
  courses: string[];
} {
  if (!items || items.length === 0) return { text: null, courses: [] };

  // 2-6 letter subject, hyphen, then a course number that may start with a
  // letter and end with letters: C1000E, 140H, 100, 1000.
  const courseRe = /\b([A-Z]{2,6})-([A-Z]?\d{2,4}[A-Z]*)\b/g;

  const parts: string[] = [];
  const allCourses: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.IsRequired === false) continue; // advisory / recommended only
    const dt = item.DisplayText;
    if (!dt) continue;

    const inItem: string[] = [];
    let m: RegExpExecArray | null;
    courseRe.lastIndex = 0;
    while ((m = courseRe.exec(dt)) !== null) {
      const code = `${m[1]} ${m[2]}`;
      inItem.push(code);
    }
    if (inItem.length === 0) continue;

    const gradeMatch = dt.match(/[Mm]inimum grade(?:\s+of)?\s+([A-Z][+-]?)/);
    const gradeNote = gradeMatch ? ` (min ${gradeMatch[1]})` : "";
    const connector = /\bor\b/i.test(dt) ? " or " : " and ";

    const partText = inItem
      .map((c) => {
        if (!seen.has(c)) {
          seen.add(c);
          allCourses.push(c);
        }
        return `${c}${gradeNote}`;
      })
      .join(connector);
    parts.push(partText);
  }

  if (parts.length === 0) return { text: null, courses: [] };
  return { text: parts.join("; "), courses: allCourses };
}

// ---------------------------------------------------------------------------
// Session + HTTP
// ---------------------------------------------------------------------------

/**
 * Prime an antiforgery session: GET the Search page, capture the
 * .ColleagueSelfServiceAntiforgery cookie and the hidden
 * __RequestVerificationToken. Both are required (and must come from the
 * same response) for every subsequent authenticated request.
 */
async function openSession(): Promise<Session> {
  const res = await fetch(
    `${BASE_URL}/Student/Courses/Search?searchResultsView=SectionListing`,
    {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: "follow",
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to load Search page: HTTP ${res.status}`);
  }
  const html = await res.text();

  const tokenMatch = html.match(
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/
  );
  if (!tokenMatch) {
    throw new Error("Could not find __RequestVerificationToken on Search page");
  }

  const setCookies =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (
          res.headers as unknown as { getSetCookie: () => string[] }
        ).getSetCookie()
      : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/g) ?? [];

  const pairs: string[] = [];
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    if (pair && pair.includes("=")) pairs.push(pair.trim());
  }
  if (pairs.length === 0) {
    throw new Error("No antiforgery cookie returned by Search page");
  }

  return { cookie: pairs.join("; "), token: tokenMatch[1], requestCount: 0 };
}

async function ensureSession(session: Session): Promise<Session> {
  if (session.requestCount >= SESSION_REFRESH_EVERY) {
    const fresh = await openSession();
    return fresh;
  }
  return session;
}

function authHeaders(session: Session): Record<string, string> {
  return {
    "User-Agent": UA,
    "Content-Type": "application/json; charset=UTF-8",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    __RequestVerificationToken: session.token,
    __IsGuestUser: "true",
    Cookie: session.cookie,
  };
}

/** GET the catalog advanced-search metadata: term tuples + subject list. */
async function getCatalogAdvancedSearch(
  session: Session
): Promise<CatalogAdvancedSearch> {
  const res = await fetch(`${BASE_URL}/Student/Courses/GetCatalogAdvancedSearch`, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      __RequestVerificationToken: session.token,
      __IsGuestUser: "true",
      Cookie: session.cookie,
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`GetCatalogAdvancedSearch failed: HTTP ${res.status}`);
  }
  return (await res.json()) as CatalogAdvancedSearch;
}

/** Build the PostSearchCriteria body for one term + subject + page. */
function searchBody(opts: {
  term: string;
  subject: string;
  pageNumber: number;
  pageSize: number;
}): Record<string, unknown> {
  return {
    keyword: null,
    terms: [opts.term],
    requirement: null,
    subrequirement: null,
    courseIds: null,
    sectionIds: null,
    requirementText: null,
    subrequirementText: "",
    group: null,
    startTime: null,
    endTime: null,
    openSections: null,
    subjects: [opts.subject],
    academicLevels: [],
    courseLevels: [],
    synonyms: [],
    courseTypes: [],
    topicCodes: [],
    days: [],
    locations: [],
    faculty: [],
    onlineCategories: null,
    keywordComponents: [],
    startDate: null,
    endDate: null,
    startsAtTime: null,
    endsByTime: null,
    pageNumber: opts.pageNumber,
    sortOn: "SectionName",
    sortDirection: "Ascending",
    subjectsBadge: [],
    locationsBadge: [],
    termFiltersBadge: [],
    daysBadge: [],
    facultyBadge: [],
    academicLevelsBadge: [],
    courseLevelsBadge: [],
    courseTypesBadge: [],
    topicCodesBadge: [],
    onlineCategoriesBadge: [],
    openSectionsBadge: "",
    openAndWaitlistedSectionsBadge: "",
    subRequirementText: null,
    quantityPerPage: opts.pageSize,
    openAndWaitlistedSections: null,
    searchResultsView: "SectionListing",
  };
}

async function postSearch(
  session: Session,
  body: Record<string, unknown>
): Promise<SearchResponse> {
  const res = await fetch(`${BASE_URL}/Student/Courses/PostSearchCriteria`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`PostSearchCriteria failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SearchResponse;
}

async function getSectionDetails(
  session: Session,
  sectionId: string
): Promise<SectionDetailsResponse> {
  const res = await fetch(`${BASE_URL}/Student/Courses/SectionDetails`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ sectionId }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`SectionDetails failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SectionDetailsResponse;
}

/** Retry a flaky network op with fresh-session recovery on failure. */
async function withRetry<T>(
  label: string,
  sessionRef: { s: Session },
  fn: (session: Session) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      sessionRef.s = await ensureSession(sessionRef.s);
      sessionRef.s.requestCount++;
      return await fn(sessionRef.s);
    } catch (e) {
      lastErr = e;
      // On any failure, re-prime the session before the next attempt — the
      // common cause is an expired/invalidated antiforgery token.
      if (attempt < MAX_RETRIES) {
        await sleep(500 * attempt);
        try {
          sessionRef.s = await openSession();
        } catch {
          /* keep old session; will retry */
        }
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapSection(s: ColleagueSection, termCode: string): CourseSection {
  // Primary in-person meeting if any (for days/time/location); otherwise the
  // first meeting. This matches how the rest of the dataset records the
  // "main" meeting block.
  const meetings = s.FormattedMeetingTimes || [];
  const primary =
    meetings.find((m) => !m.IsOnline && (m.BuildingDisplay || m.RoomDisplay)) ||
    meetings.find((m) => m.DaysOfWeekDisplay) ||
    meetings[0];

  const prefix = s.Course?.SubjectCode || (s.CourseName?.split("-")[0] ?? "");
  const number = s.Course?.Number || s.CourseName?.split("-")[1] || "";
  const title = s.Course?.Title || s.Title || "";

  // CRN: Canyons' Synonym (e.g. "98379") is the registration number students
  // use; SectionNameDisplay is "BIOSCI-100-98379". Prefer Synonym, fall back
  // to Number, then the trailing piece of SectionNameDisplay, then Id.
  let crn = s.Synonym || s.Number || "";
  if (!crn && s.SectionNameDisplay) {
    const parts = s.SectionNameDisplay.split("-");
    crn = parts[parts.length - 1] || "";
  }
  if (!crn) crn = s.Id;

  const credits = s.MinimumCredits ?? s.Course?.MinimumCredits ?? 0;

  // Location string: prefer the specific building+room of the primary
  // in-person meeting; fall back to the section's LocationDisplay.
  let location = s.LocationDisplay || "";
  if (primary && !primary.IsOnline) {
    const bld = (primary.BuildingDisplay || "").trim();
    const room = (primary.RoomDisplay || "").trim();
    const built = [bld, room].filter(Boolean).join(" ");
    if (built) location = built;
  }

  // Seats: when seat counts aren't published, record null rather than 0.
  const seatsAvailable =
    s.AreSeatCountsAvailable === false ? null : s.Available ?? null;
  const seatsTotal =
    s.AreSeatCountsAvailable === false ? null : s.Capacity ?? null;

  const instructorArr = (s.FacultyDisplay || []).filter(Boolean);
  const instructor = instructorArr.length > 0 ? instructorArr.join(", ") : null;

  return {
    college_code: COLLEGE_CODE,
    term: termCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn,
    days: daysFromMeeting(primary),
    start_time: primary?.StartTimeDisplay || "",
    end_time: primary?.EndTimeDisplay || "",
    start_date: normalizeDate(s.StartDateDisplay || ""),
    location,
    campus: s.LocationDisplay || s.LocationCode || "",
    mode: determineMode(s),
    instructor,
    seats_open: seatsAvailable,
    seats_total: seatsTotal,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Scrape one term
// ---------------------------------------------------------------------------

async function scrapeTerm(
  sessionRef: { s: Session },
  term: TermTuple,
  subjects: SubjectInfo[],
  subjectFilter?: string
): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  // Map course-key → a representative section Id that declares a required
  // requisite, so we fetch each course's prereqs at most once.
  const reqCourses = new Map<string, string>();

  const subjList = subjectFilter
    ? subjects.filter((s) => s.Code === subjectFilter)
    : subjects;

  console.log(
    `\n=== ${term.code} (${term.description}): ${subjList.length} subjects ===`
  );

  for (let i = 0; i < subjList.length; i++) {
    const subj = subjList[i];
    let pageNumber = 1;
    let totalPages = 1;
    let subjCount = 0;

    while (pageNumber <= totalPages) {
      const body = searchBody({
        term: term.code,
        subject: subj.Code,
        pageNumber,
        pageSize: 30, // site caps SectionListing at 30/page regardless
      });

      let resp: SearchResponse;
      try {
        resp = await withRetry(
          `search ${subj.Code} p${pageNumber}`,
          sessionRef,
          (session) => postSearch(session, body)
        );
      } catch (e) {
        console.error(`  ! ${subj.Code} page ${pageNumber}: ${e}`);
        break;
      }

      if (pageNumber === 1) totalPages = resp.TotalPages || 1;

      for (const raw of resp.Sections || []) {
        const mapped = mapSection(raw, term.code);
        sections.push(mapped);
        subjCount++;

        const courseReqs = raw.Course?.Requisites || [];
        const hasRequired = courseReqs.some((r) => r.IsRequired);
        if (hasRequired) {
          const key = `${mapped.course_prefix} ${mapped.course_number}`;
          if (!reqCourses.has(key)) reqCourses.set(key, raw.Id);
        }
      }

      pageNumber++;
      if (pageNumber <= totalPages) await sleep(PAGE_DELAY_MS);
    }

    const prog = `[${i + 1}/${subjList.length}]`;
    console.log(
      `  ${prog} ${subj.Code.padEnd(8)} ${subjCount} sections` +
        (totalPages > 1 ? ` (${totalPages} pages)` : "")
    );
    await sleep(SUBJECT_DELAY_MS);
  }

  // Prereq enrichment.
  if (reqCourses.size > 0) {
    console.log(
      `  Enriching prerequisites for ${reqCourses.size} courses with required requisites...`
    );
    const prereqMap = await fetchPrereqs(sessionRef, reqCourses);
    let applied = 0;
    for (const sec of sections) {
      const key = `${sec.course_prefix} ${sec.course_number}`;
      const pr = prereqMap.get(key);
      if (pr) {
        sec.prerequisite_text = pr.text;
        sec.prerequisite_courses = pr.courses;
        applied++;
      }
    }
    console.log(
      `  Applied prerequisites to ${applied} sections (${prereqMap.size} distinct courses had parseable prereqs)`
    );
  }

  return sections;
}

async function fetchPrereqs(
  sessionRef: { s: Session },
  reqCourses: Map<string, string>
): Promise<Map<string, { text: string | null; courses: string[] }>> {
  const out = new Map<string, { text: string | null; courses: string[] }>();
  const entries = Array.from(reqCourses.entries());

  for (let i = 0; i < entries.length; i += PREREQ_BATCH_SIZE) {
    const batch = entries.slice(i, i + PREREQ_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([key, sectionId]) => {
        try {
          const detail = await withRetry(
            `details ${key}`,
            sessionRef,
            (session) => getSectionDetails(session, sectionId)
          );
          return { key, items: detail.RequisiteItems || [] };
        } catch {
          return { key, items: [] as RequisiteItem[] };
        }
      })
    );
    for (const { key, items } of results) {
      const parsed = parseRequisites(items);
      if (parsed.text) out.set(key, parsed);
    }
    if (i + PREREQ_BATCH_SIZE < entries.length) {
      await sleep(PREREQ_BATCH_DELAY_MS);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Term selection
// ---------------------------------------------------------------------------

/**
 * Resolve a --term filter token against the discovered term tuples. Accepts
 * native codes ("2026FA"), human names ("Fall 2026"), and the canonical
 * season-year tokens. Returns the subset of discovered terms that match;
 * with no filter, returns all discovered terms.
 */
function selectTerms(all: TermTuple[], filter?: string): TermTuple[] {
  if (!filter) return all;
  const wanted = filter
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  const SEASON: Record<string, string> = {
    spring: "SP",
    summer: "SU",
    fall: "FA",
    winter: "WI",
  };

  const out: TermTuple[] = [];
  for (const term of all) {
    for (const w of wanted) {
      const code = term.code.toLowerCase();
      const desc = term.description.toLowerCase();
      // exact code, exact description, or reconstructed YYYY+season code
      let canon: string | null = null;
      const ym = w.match(/(20\d{2})/);
      const sm = w.match(/(spring|summer|fall|winter)/);
      if (ym && sm) canon = `${ym[1]}${SEASON[sm[1]]}`.toLowerCase();
      if (code === w || desc === w || (canon && code === canon)) {
        if (!out.includes(term)) out.push(term);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Args {
  term?: string;
  subject?: string;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--term") out.term = argv[++i];
    else if (a === "--subject") out.subject = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`scrape-canyons.ts — College of the Canyons course scraper

Usage:
  npx tsx scripts/ca/scrape-canyons.ts [options]

Options:
  --term <t>       Only scrape these term(s). Comma-separated. Accepts native
                   codes (2026FA) or names ("Fall 2026"). Default: all exposed.
  --subject <code> Only scrape this subject (debug). E.g. BIOSCI.
  --dry-run        Scrape but do not write JSON files.
  --help           Show this help.

Writes data/ca/courses/college-of-the-canyons/<TERM>.json (TERM = 2026FA etc.).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  console.log(`College of the Canyons scraper — ${BASE_URL}`);

  // 1. Open session.
  const session = await openSession();
  const sessionRef = { s: session };
  console.log("Opened antiforgery session (cookie + token).");

  // 2. Term + subject discovery via GetCatalogAdvancedSearch.
  sessionRef.s.requestCount++;
  const catalog = await getCatalogAdvancedSearch(sessionRef.s);

  const allTerms: TermTuple[] = (catalog.Terms || [])
    .map((t) => ({ code: t.Item1 || "", description: t.Item2 || "" }))
    .filter((t) => t.code);
  if (allTerms.length === 0) {
    console.error(
      "Term discovery FAILED: GetCatalogAdvancedSearch returned no Terms. " +
        "Not writing any files."
    );
    process.exit(1);
  }
  console.log(
    `Discovered ${allTerms.length} term(s) via GetCatalogAdvancedSearch.Terms: ` +
      allTerms.map((t) => `${t.code} (${t.description})`).join(", ")
  );

  const subjects = (catalog.Subjects || []).filter(
    (s) => s.Code && s.ShowInCourseSearch !== false
  );
  if (subjects.length === 0) {
    console.error("No subjects discovered. Not writing any files.");
    process.exit(1);
  }
  console.log(`Discovered ${subjects.length} subjects.`);

  // 3. Select terms to scrape.
  const terms = selectTerms(allTerms, args.term);
  if (terms.length === 0) {
    console.error(
      `--term "${args.term}" matched none of the discovered terms ` +
        `(${allTerms.map((t) => t.code).join(", ")}).`
    );
    process.exit(1);
  }
  console.log(`Scraping term(s): ${terms.map((t) => t.code).join(", ")}`);

  // 4. Scrape each term and write its file.
  const outDir = path.join(
    process.cwd(),
    "data",
    STATE,
    "courses",
    COLLEGE_CODE
  );

  const summary: Array<{ term: string; count: number }> = [];

  for (const term of terms) {
    const sections = await scrapeTerm(
      sessionRef,
      term,
      subjects,
      args.subject
    );

    if (sections.length === 0) {
      console.warn(
        `  No sections found for ${term.code}; not writing a file (no stub).`
      );
      summary.push({ term: term.code, count: 0 });
      continue;
    }

    if (args.dryRun) {
      console.log(
        `  [dry-run] ${term.code}: ${sections.length} sections (not written)`
      );
    } else {
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${term.code}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`  Wrote ${sections.length} sections → ${outPath}`);
    }
    summary.push({ term: term.code, count: sections.length });
  }

  console.log("\n=== Summary ===");
  for (const s of summary) {
    console.log(`  ${s.term}: ${s.count} sections`);
  }
  const total = summary.reduce((a, b) => a + b.count, 0);
  console.log(`  Total: ${total} sections`);
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

export { parseRequisites, daysFromMeeting, determineMode, normalizeDate };
