/**
 * scrape-socccd.ts — South Orange County CCD "SmartSchedule" class search
 *
 * Two colleges share ONE public SmartSchedule React SPA whose JSON API
 * auto-mints a guest JWT (no login):
 *   - saddleback-college    → collegeTenantDefinedId "S" (collegeKey 1)
 *   - irvine-valley-college → collegeTenantDefinedId "I" (collegeKey 2)
 *   - institutionKey = 1 for both.
 *
 * Auth bootstrap (no Playwright needed): a plain GET to any SmartSchedule web
 * page sets a guest JWT cookie `.SmartScheduleWeb.ApiToken`
 * (sub:guest, role:scheduleReader, ~2 h TTL). We harvest it from Set-Cookie and
 * send it as `Authorization: Bearer <token>` to the API host. The token expires
 * after ~2 h, so we re-bootstrap automatically on a 401/login-redirect.
 *
 * Endpoints discovered by driving the SPA with Playwright and reading the
 * webpack bundle (https://classes.socccd.edu/smartscheduleweb/main.*.js):
 *
 *   GET  class/index/1/{S|I}/{termTenantDefinedId}/MarketingCode
 *        → navigation index. Its `classIndexTermOptions[]` is the authoritative
 *          per-college term list: { termTenantDefinedId, termKey, termDisplayName,
 *          isActiveTerm }. termKey differs per college for the same term
 *          (Saddleback Fall 2026 = 60, IVC Fall 2026 = 66), so we resolve it
 *          per (college, term).
 *
 *   POST class  (host https://classesapi.socccd.edu/smartscheduleapi/api/class)
 *        body: { searchTerm:"", institutionKey:1, termKeys:[<termKey>],
 *                collegeKeys:[<collegeKey>], searchFrom, searchSize,
 *                searchCategory:"All", searchSource:"global",
 *                categoryApprovalStatusCodes:["A"], logSearch:false,
 *                isBannerTerm:true }
 *        → { sections:[…], courses:[…], totalSearchResultsCount } where
 *          `courses[]` maps courseKey → courseDisplayCode / courseDisplayTitle
 *          and `courses[].subTerms[]` maps sectionKey → fromDate (start_date).
 *          Empty searchTerm + searchSource "global" returns ALL sections,
 *          paginated via searchFrom/searchSize.
 *
 * Term code format (YYYY + season digit + 0): SP=…3 0, SU=…5 0, FA=…7 0.
 *   Fall 2026 = 202670, Summer 2026 = 202650, Spring 2026 = 202630.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-socccd.ts
 *   npx tsx scripts/ca/scrape-socccd.ts --college saddleback-college
 *   npx tsx scripts/ca/scrape-socccd.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-socccd.ts --college irvine-valley-college --term "Spring 2026"
 *
 * Idempotent: rewrites data/ca/courses/<slug>/<TERM>.json in full each run.
 */

import * as fs from "fs";
import * as path from "path";

const WEB = "https://classes.socccd.edu/smartscheduleweb";
const API = "https://classesapi.socccd.edu/smartscheduleapi/api";
const INSTITUTION_KEY = 1;
const PAGE_SIZE = 200; // server caps searchMaxResult at 200

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface CollegeSpec {
  slug: string;
  collegeKey: number;
  tenantId: "S" | "I";
  campus: string;
}

const COLLEGES: CollegeSpec[] = [
  { slug: "saddleback-college", collegeKey: 1, tenantId: "S", campus: "Saddleback College" },
  { slug: "irvine-valley-college", collegeKey: 2, tenantId: "I", campus: "Irvine Valley College" },
];

// Terms we attempt to scrape, by display name. termKey is resolved per-college
// at runtime from class/index; the tenant-defined id is the YYYY+season code.
interface TermSpec {
  name: string; // matches termDisplayName from the API, and the --term filter
  tenantId: string; // termTenantDefinedId, e.g. "202670"
  fileTerm: string; // output filename stem, e.g. "2026FA"
}

const TERMS: TermSpec[] = [
  { name: "Fall 2026", tenantId: "202670", fileTerm: "2026FA" },
  { name: "Spring 2026", tenantId: "202630", fileTerm: "2026SP" },
  { name: "Summer 2026", tenantId: "202650", fileTerm: "2026SU" },
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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Auth — harvest the guest JWT from a SmartSchedule web page's Set-Cookie
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;

async function bootstrapToken(tenantId: string, termTenantId: string): Promise<string> {
  const url = `${WEB}/index/${INSTITUTION_KEY}/${tenantId}/${termTenantId}/MarketingCode`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "manual",
  });
  // Set-Cookie may be exposed via getSetCookie() (Node 20+) or the raw header.
  const cookies: string[] =
    typeof (res.headers as any).getSetCookie === "function"
      ? (res.headers as any).getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  for (const c of cookies) {
    const m = c.match(/\.SmartScheduleWeb\.ApiToken=([^;]+)/);
    if (m) {
      cachedToken = m[1];
      return cachedToken;
    }
  }
  throw new Error(`Could not mint guest token from ${url} (HTTP ${res.status})`);
}

async function apiFetch(
  pathName: string,
  init: RequestInit,
  ctx: { tenantId: string; termTenantId: string },
  attempt = 0,
): Promise<Response> {
  if (!cachedToken) await bootstrapToken(ctx.tenantId, ctx.termTenantId);
  const res = await fetch(`${API}/${pathName}`, {
    ...init,
    headers: {
      "User-Agent": UA,
      Authorization: `Bearer ${cachedToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://classes.socccd.edu",
      Referer: "https://classes.socccd.edu/",
      ...(init.headers || {}),
    },
    redirect: "manual",
  });
  // Token expired → 401 or a 302 to /Account/Login. Re-mint once and retry.
  const isAuthFail =
    res.status === 401 ||
    (res.status >= 300 &&
      res.status < 400 &&
      /Account\/Login/i.test(res.headers.get("location") || ""));
  if (isAuthFail && attempt < 2) {
    cachedToken = null;
    await bootstrapToken(ctx.tenantId, ctx.termTenantId);
    return apiFetch(pathName, init, ctx, attempt + 1);
  }
  if (!res.ok && res.status >= 500 && attempt < 3) {
    await sleep(1000 * (attempt + 1));
    return apiFetch(pathName, init, ctx, attempt + 1);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Term resolution — get the per-college termKey for a tenant-defined term id
// ---------------------------------------------------------------------------

interface TermOption {
  termTenantDefinedId: string;
  termKey: number;
  termDisplayName: string;
  isActiveTerm: boolean;
}

async function getTermOptions(college: CollegeSpec, termTenantId: string): Promise<TermOption[]> {
  const res = await apiFetch(
    `class/index/${INSTITUTION_KEY}/${college.tenantId}/${termTenantId}/MarketingCode`,
    { method: "GET" },
    { tenantId: college.tenantId, termTenantId },
  );
  if (!res.ok) throw new Error(`class/index HTTP ${res.status} for ${college.slug}/${termTenantId}`);
  const data = await res.json();
  return (data.classIndexTermOptions || []) as TermOption[];
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const DAY_MAP: Record<string, string> = {
  M: "M",
  T: "Tu",
  W: "W",
  Th: "Th",
  F: "F",
  S: "Sa",
  Sa: "Sa",
  Su: "Su",
};

/** "M W" / "T Th" / "Online" / "TBA" → "MW" / "TuTh" / "" */
function parseDays(raw: string): string {
  if (!raw) return "";
  const t = raw.trim();
  if (/^(online|tba|arr|arranged)$/i.test(t)) return "";
  const tokens = t.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const tok of tokens) {
    const mapped = DAY_MAP[tok];
    if (mapped) out.push(mapped);
    // unknown tokens (e.g. "Online" mixed in) are skipped
  }
  return out.join("");
}

/** Parse "H:MMAM"/"H:MM PM" → minutes since midnight, or null. */
function toMinutes(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function fmtTime(mins: number): string {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ap}`;
}

/**
 * Parse "10:30AM - 11:45" → { start:"10:30 AM", end:"11:45 AM" }.
 * The end time carries no AM/PM; infer the meridiem that keeps end after start
 * within a normal class window (< 12 h span).
 */
function parseTimes(raw: string): { start: string; end: string } {
  if (!raw || !raw.trim() || /TBA|ARR/i.test(raw)) return { start: "", end: "" };
  const m = raw.match(/^(.+?)\s*-\s*(.+)$/);
  if (!m) {
    const single = toMinutes(raw.trim());
    return single != null ? { start: fmtTime(single), end: "" } : { start: "", end: "" };
  }
  const startMin = toMinutes(m[1]);
  if (startMin == null) return { start: "", end: "" };

  const endRaw = m[2].trim();
  // If end already has a meridiem, trust it.
  const endHasAp = /[AP]M$/i.test(endRaw);
  if (endHasAp) {
    const e = toMinutes(endRaw);
    return { start: fmtTime(startMin), end: e != null ? fmtTime(e) : "" };
  }
  const em = endRaw.match(/^(\d{1,2}):(\d{2})$/);
  if (!em) return { start: fmtTime(startMin), end: "" };
  const eh = parseInt(em[1], 10) % 12;
  const emin = parseInt(em[2], 10);
  // Try AM then PM; pick the first that is >= start and within 6h of start.
  const candidates = [eh * 60 + emin, (eh + 12) * 60 + emin];
  for (const c of candidates) {
    if (c >= startMin && c - startMin <= 6 * 60) {
      return { start: fmtTime(startMin), end: fmtTime(c) };
    }
  }
  // Fallback: same meridiem as start.
  const startPm = startMin >= 12 * 60;
  const end = startPm ? (eh + 12) * 60 + emin : eh * 60 + emin;
  return { start: fmtTime(startMin), end: fmtTime(end >= startMin ? end : end + 12 * 60) };
}

/** Split "ACCT 1A" → { prefix:"ACCT", number:"1A" }. */
function splitCourseCode(displayCode: string): { prefix: string; number: string } | null {
  const m = displayCode.trim().match(/^([A-Za-z/&]+)\s+(\S+)$/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2] };
}

function parseSeats(text: string | null | undefined): number | null {
  if (text == null) return null;
  const t = String(text).trim();
  if (t === "") return null;
  const n = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify a section's modality from its meeting rows.
 *   - all rows online, none with a meeting day/time → "online" (asynchronous)
 *   - all rows online, at least one with a real meeting day/time → "zoom" (sync)
 *   - some online + some in-person rows → "hybrid"
 *   - otherwise → "in-person"
 */
function classifyMode(schedules: any[]): string {
  if (!schedules || schedules.length === 0) return "online";
  const rows = schedules.map((cs) => {
    const online = !!(cs.location && cs.location.isLocationOnline) || /online/i.test(cs.instructionMethod || "");
    const hasMeeting =
      !!(cs.time && cs.time.trim()) &&
      !!cs.day &&
      !/^(online|tba|arr|arranged)$/i.test(cs.day.trim());
    return { online, hasMeeting };
  });
  const anyOnline = rows.some((r) => r.online);
  const anyInPerson = rows.some((r) => !r.online);
  if (anyOnline && anyInPerson) return "hybrid";
  if (anyOnline && !anyInPerson) {
    return rows.some((r) => r.hasMeeting) ? "zoom" : "online";
  }
  return "in-person";
}

/** Pull course-prefix references out of a prerequisite description string. */
function extractPrereqCourses(text: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /\b([A-Z]{2,5})\s+([0-9]+[A-Z]{0,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(`${m[1]} ${m[2]}`);
  return Array.from(new Set(out));
}

// ---------------------------------------------------------------------------
// Section building
// ---------------------------------------------------------------------------

interface CourseMeta {
  displayCode: string;
  title: string;
  prereqText: string | null;
}

function buildSection(
  raw: any,
  course: CourseMeta | undefined,
  startDate: string,
  college: CollegeSpec,
  fileTerm: string,
): CourseSection | null {
  const code = course?.displayCode || raw.courseDisplayCode || "";
  const split = splitCourseCode(code);
  if (!split) return null;

  const schedules: any[] = raw.classSchedules || [];
  // Choose the primary meeting row for day/time/location/instructor: prefer a
  // row that actually has a day+time; fall back to the first row.
  const primary =
    schedules.find((cs) => cs.time && cs.time.trim() && cs.day && cs.day !== "Online" && cs.day !== "TBA") ||
    schedules[0] ||
    null;

  const { start, end } = parseTimes(primary?.time || "");
  // Combine day tokens across all in-person/sync rows (skip pure "Online"/"TBA").
  const dayParts = schedules
    .map((cs) => parseDays(cs.day || ""))
    .filter((d) => d);
  const days = Array.from(new Set(dayParts.join("").match(/(Tu|Th|Sa|Su|M|W|F)/g) || [])).join("");

  // Location: first non-online physical room, else "ONLINE", else first label.
  let location = "";
  const physical = schedules.find((cs) => cs.location && !cs.location.isLocationOnline && cs.location.displayName);
  if (physical) location = physical.location.displayName;
  else if (schedules.some((cs) => cs.location && cs.location.isLocationOnline)) location = "ONLINE";
  else if (primary?.location?.displayName) location = primary.location.displayName;

  const instructorName =
    schedules.map((cs) => cs.instructor?.instructorName).find((n) => n && n.trim()) || null;

  const seatsTotal = parseSeats(raw.totalSeatCountText);
  const seatsOpen = parseSeats(raw.availableSeatCountText);

  const units = typeof raw.units === "number" ? raw.units : parseFloat(raw.units) || 0;

  return {
    college_code: college.slug,
    term: fileTerm,
    course_prefix: split.prefix,
    course_number: split.number,
    course_title: course?.title || "",
    credits: units,
    crn: String(raw.sectionTenantDefinedId || raw.sectionDisplayCode || ""),
    days: days || "",
    start_time: start,
    end_time: end,
    start_date: startDate,
    location,
    campus: college.campus,
    mode: classifyMode(schedules),
    instructor: instructorName,
    seats_open: seatsOpen,
    seats_total: seatsTotal,
    prerequisite_text: course?.prereqText || null,
    prerequisite_courses: extractPrereqCourses(course?.prereqText || null),
  };
}

// ---------------------------------------------------------------------------
// Per-(college, term) scrape
// ---------------------------------------------------------------------------

async function scrapeCollegeTerm(
  college: CollegeSpec,
  term: TermSpec,
): Promise<CourseSection[] | null> {
  // Resolve the per-college termKey, and confirm the term exists.
  let options: TermOption[];
  try {
    options = await getTermOptions(college, term.tenantId);
  } catch (err) {
    console.warn(`  [${college.slug}] ${term.name}: index fetch failed — ${(err as Error).message}`);
    return null;
  }
  const opt = options.find((o) => o.termTenantDefinedId === term.tenantId);
  if (!opt) {
    console.log(`  [${college.slug}] ${term.name}: term ${term.tenantId} not offered — skipping`);
    return null;
  }
  const termKey = opt.termKey;
  console.log(`  [${college.slug}] ${term.name} → termKey ${termKey} (active=${opt.isActiveTerm})`);

  const sections: CourseSection[] = [];
  const seenCrn = new Set<string>();
  let from = 0;
  let total = Infinity;

  while (from < total) {
    const body = {
      searchTerm: "",
      institutionKey: INSTITUTION_KEY,
      termKeys: [termKey],
      collegeKeys: [college.collegeKey],
      searchFrom: from,
      searchSize: PAGE_SIZE,
      searchCategory: "All",
      searchSource: "global",
      categoryApprovalStatusCodes: ["A"],
      logSearch: false,
      isBannerTerm: true,
    };
    const res = await apiFetch(
      "class",
      { method: "POST", body: JSON.stringify(body) },
      { tenantId: college.tenantId, termTenantId: term.tenantId },
    );
    if (!res.ok) {
      console.warn(`    page from=${from}: HTTP ${res.status}; stopping this term`);
      break;
    }
    const data = await res.json();
    total = typeof data.totalSearchResultsCount === "number" ? data.totalSearchResultsCount : 0;
    const pageSections: any[] = data.sections || [];

    // Build courseKey → metadata and sectionKey → start_date maps for this page.
    const courseMeta = new Map<number, CourseMeta>();
    const startDateByKey = new Map<number, string>();
    for (const c of data.courses || []) {
      courseMeta.set(c.courseKey, {
        displayCode: c.courseDisplayCode || "",
        title: c.courseDisplayTitle || "",
        prereqText: c.prerequisiteRulesDescription || null,
      });
      for (const st of c.subTerms || []) {
        const from = (st.fromDate || "").slice(0, 10);
        for (const sk of st.sectionKeys || []) {
          if (from) startDateByKey.set(sk, from);
        }
      }
    }

    for (const raw of pageSections) {
      const crn = String(raw.sectionTenantDefinedId || raw.sectionDisplayCode || "");
      if (crn && seenCrn.has(crn)) continue; // idempotent de-dupe across pages
      const startDate = startDateByKey.get(raw.sectionKey) || "";
      const sec = buildSection(raw, courseMeta.get(raw.courseKey), startDate, college, term.fileTerm);
      if (sec) {
        if (sec.crn) seenCrn.add(sec.crn);
        sections.push(sec);
      }
    }

    console.log(`    page from=${from}: +${pageSections.length} (running ${sections.length}/${total})`);
    if (pageSections.length === 0) break;
    from += PAGE_SIZE;
    await sleep(300);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };

  const collegeFilter = getArg("--college");
  const termFilter = getArg("--term");

  const colleges = collegeFilter
    ? COLLEGES.filter((c) => c.slug === collegeFilter)
    : COLLEGES;
  if (colleges.length === 0) {
    console.error(`Unknown --college "${collegeFilter}". Valid: ${COLLEGES.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }

  const terms = termFilter ? TERMS.filter((t) => t.name === termFilter) : TERMS;
  if (terms.length === 0) {
    console.error(`Unknown --term "${termFilter}". Valid: ${TERMS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  for (const college of colleges) {
    const dataDir = path.join(process.cwd(), "data", "ca", "courses", college.slug);
    for (const term of terms) {
      console.log(`\n=== ${college.slug} :: ${term.name} (${term.fileTerm}.json) ===`);
      let sections: CourseSection[] | null = null;
      try {
        sections = await scrapeCollegeTerm(college, term);
      } catch (err) {
        console.warn(`  scrape failed: ${(err as Error).message}`);
        sections = null;
      }
      if (!sections || sections.length === 0) {
        console.log(`  no sections for ${college.slug} / ${term.name}; writing nothing`);
        continue;
      }
      fs.mkdirSync(dataDir, { recursive: true });
      const outPath = path.join(dataDir, `${term.fileTerm}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`  wrote ${sections.length} sections → ${outPath}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
