/**
 * scrape-banner.ts
 *
 * Scrapes course section data from SC technical colleges that use
 * Ellucian Banner Self-Service 9. Uses the Banner REST API directly
 * (no browser needed).
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-banner.ts --college piedmont
 *   npx tsx scripts/sc/scrape-banner.ts --college piedmont --term "Fall 2026"
 *   npx tsx scripts/sc/scrape-banner.ts --all
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;
const DELAY_MS = 300;

const BANNER_COLLEGES: Record<string, string> = {
  "piedmont": "https://banner.ptc.edu",
  "tri-county": "https://prodban.tctc.edu",
  "central-carolina": "https://selfservice.cctech.edu",
};

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

// ---------------------------------------------------------------------------
// Banner API helpers
// ---------------------------------------------------------------------------

interface BannerTerm {
  code: string;
  description: string;
}

interface BannerMeetingTime {
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
  building: string | null;
  buildingDescription: string | null;
  campus: string | null;
  campusDescription: string | null;
  room: string | null;
  meetingScheduleType: string | null;
}

interface BannerFacultyMeeting {
  faculty: Array<{ displayName: string }>;
  meetingTime: BannerMeetingTime;
}

interface BannerSection {
  subject: string;
  courseNumber: string;
  courseTitle: string;
  creditHours: number | null;
  creditHourLow: number | null;
  courseReferenceNumber: string;
  maximumEnrollment: number;
  enrollment: number;
  seatsAvailable: number;
  campusDescription: string;
  scheduleTypeDescription: string;
  instructionalMethodDescription: string | null;
  meetingsFaculty: BannerFacultyMeeting[];
}

async function getTerms(baseUrl: string): Promise<BannerTerm[]> {
  const resp = await fetch(
    `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30`,
    { headers: { Accept: "application/json" } }
  );
  if (!resp.ok) throw new Error(`Failed to get terms: ${resp.status}`);
  return resp.json();
}

async function setTerm(
  baseUrl: string,
  termCode: string,
  cookies: string
): Promise<string> {
  const resp = await fetch(
    `${baseUrl}/StudentRegistrationSsb/ssb/term/search?mode=search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
      },
      body: `term=${termCode}`,
      redirect: "manual",
    }
  );
  // Collect Set-Cookie headers
  const setCookies = resp.headers.getSetCookie?.() || [];
  const newCookies = setCookies
    .map((c) => c.split(";")[0])
    .join("; ");
  return newCookies || cookies;
}

async function searchSections(
  baseUrl: string,
  termCode: string,
  offset: number,
  cookies: string
): Promise<{ data: BannerSection[]; totalCount: number }> {
  const url = new URL(
    `${baseUrl}/StudentRegistrationSsb/ssb/searchResults/searchResults`
  );
  url.searchParams.set("txt_term", termCode);
  url.searchParams.set("pageOffset", String(offset));
  url.searchParams.set("pageMaxSize", String(PAGE_SIZE));
  url.searchParams.set("sortColumn", "subjectDescription");
  url.searchParams.set("sortDirection", "asc");

  const resp = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Cookie: cookies,
    },
  });
  if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function formatTime(bannerTime: string | null): string {
  if (!bannerTime || bannerTime.length < 4) return "";
  const hours = parseInt(bannerTime.slice(0, 2));
  const minutes = bannerTime.slice(2, 4);
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${minutes} ${period}`;
}

function formatDate(bannerDate: string | null): string {
  if (!bannerDate) return "";
  // Banner dates are "MM/DD/YYYY"
  const parts = bannerDate.split("/");
  if (parts.length !== 3) return bannerDate;
  return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

function buildDays(mt: BannerMeetingTime): string {
  const days: string[] = [];
  if (mt.monday) days.push("M");
  if (mt.tuesday) days.push("Tu");
  if (mt.wednesday) days.push("W");
  if (mt.thursday) days.push("Th");
  if (mt.friday) days.push("F");
  if (mt.saturday) days.push("Sa");
  if (mt.sunday) days.push("Su");
  return days.join(" ");
}

function detectMode(
  section: BannerSection,
  meetings: BannerFacultyMeeting[]
): CourseMode {
  const desc = (
    section.scheduleTypeDescription +
    " " +
    (section.instructionalMethodDescription || "")
  ).toLowerCase();

  if (desc.includes("online") || desc.includes("internet")) {
    if (desc.includes("hybrid") || desc.includes("blended")) return "hybrid";
    return "online";
  }
  if (desc.includes("zoom") || desc.includes("virtual")) return "zoom";
  if (desc.includes("hybrid") || desc.includes("blended")) return "hybrid";

  // Check if all meetings have no physical location
  const hasPhysical = meetings.some(
    (m) =>
      m.meetingTime.building &&
      !["OL", "ONLINE", "WEB", "VIRT"].includes(
        m.meetingTime.building.toUpperCase()
      )
  );
  const hasTime = meetings.some((m) => m.meetingTime.beginTime);

  if (!hasPhysical && !hasTime) return "online";
  return "in-person";
}

// ---------------------------------------------------------------------------
// Prerequisite helpers (ported from DC scraper, parameterized for multi-college)
// ---------------------------------------------------------------------------

interface PrereqInfo {
  text: string;       // e.g. "ENG 101 (min C) or ENG 101H (min C)"
  courses: string[];  // e.g. ["ENG 101", "ENG 101H"]
}

async function buildSubjectMap(
  baseUrl: string,
  termCode: string,
  cookies: string
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const res = await fetch(
      `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${termCode}&offset=1&max=500`,
      { headers: { Cookie: cookies } }
    );
    const subjects: { code: string; description: string }[] = await res.json();
    for (const s of subjects) {
      map[s.description.toLowerCase()] = s.code;
    }
    console.log(`  Built subject map: ${Object.keys(map).length} subjects`);
  } catch (e) {
    console.warn("  Warning: Could not fetch subject map, prereq names may use full names");
  }
  return map;
}

function parsePrereqHtml(
  html: string,
  subjectMap: Record<string, string>
): PrereqInfo | null {
  if (html.includes("No prerequisite")) return null;

  const rows: { andOr: string; subject: string; courseNum: string; grade: string }[] = [];
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
    const prefix = subjectMap[row.subject.toLowerCase()] || row.subject;
    const courseCode = `${prefix} ${row.courseNum}`;
    const gradeNote = row.grade && row.grade !== "TR" ? ` (min ${row.grade})` : "";
    const connector = row.andOr ? ` ${row.andOr.toLowerCase()} ` : "";

    if (connector && parts.length > 0) {
      parts.push(connector);
    }
    parts.push(`${courseCode}${gradeNote}`);

    if (row.grade !== "TR" && !courses.includes(courseCode)) {
      courses.push(courseCode);
    }
  }

  return {
    text: parts.join("").trim(),
    courses,
  };
}

async function fetchPrerequisites(
  baseUrl: string,
  termCode: string,
  sections: BannerSection[],
  cookies: string,
  subjectMap: Record<string, string>
): Promise<Map<string, PrereqInfo>> {
  // Deduplicate: one CRN per unique course
  const courseMap = new Map<string, string>();
  for (const s of sections) {
    const key = `${s.subject} ${s.courseNumber}`;
    if (!courseMap.has(key)) {
      courseMap.set(key, s.courseReferenceNumber);
    }
  }

  console.log(`  Fetching prerequisites for ${courseMap.size} unique courses...`);
  const prereqs = new Map<string, PrereqInfo>();
  const entries = Array.from(courseMap.entries());
  const BATCH_SIZE = 10;
  let fetched = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([courseKey, crn]) => {
        try {
          const res = await fetch(
            `${baseUrl}/StudentRegistrationSsb/ssb/searchResults/getSectionPrerequisites?term=${termCode}&courseReferenceNumber=${crn}`,
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
      console.log(`    prereqs: ${fetched}/${entries.length} (${prereqs.size} with prereqs)`);
    }
  }

  return prereqs;
}

// ---------------------------------------------------------------------------

function mapSection(
  slug: string,
  termCode: string,
  section: BannerSection,
  prereq?: PrereqInfo
): CourseSection {
  const meetings = section.meetingsFaculty || [];
  const primary = meetings[0]?.meetingTime;

  // Get instructor from first meeting with faculty
  let instructor: string | null = null;
  for (const mf of meetings) {
    if (mf.faculty && mf.faculty.length > 0) {
      instructor = mf.faculty[0].displayName;
      break;
    }
  }

  return {
    college_code: slug,
    term: termCode,
    course_prefix: section.subject,
    course_number: section.courseNumber,
    course_title: section.courseTitle,
    credits: section.creditHours || section.creditHourLow || 0,
    crn: section.courseReferenceNumber,
    days: primary ? buildDays(primary) : "",
    start_time: primary ? formatTime(primary.beginTime) : "",
    end_time: primary ? formatTime(primary.endTime) : "",
    start_date: primary ? formatDate(primary.startDate) : "",
    location: primary
      ? [primary.buildingDescription, primary.room]
          .filter(Boolean)
          .join(" ")
      : "",
    campus: primary?.campusDescription || section.campusDescription || "",
    mode: detectMode(section, meetings),
    instructor,
    seats_open: section.seatsAvailable,
    seats_total: section.maximumEnrollment,
    prerequisite_text: prereq?.text || null,
    prerequisite_courses: prereq?.courses || [],
  };
}

// ---------------------------------------------------------------------------
// Main scraping logic
// ---------------------------------------------------------------------------

function matchTerm(
  terms: BannerTerm[],
  termName: string
): BannerTerm | undefined {
  const lower = termName.toLowerCase();
  const parts = lower.split(/\s+/); // ["fall", "2026"]

  return terms.find((t) => {
    const desc = t.description.toLowerCase();
    // Skip CE (non-credit), employee training, and view-only terms
    if (desc.includes("non credit") || desc.includes("employee")) return false;
    // All parts must appear in description
    return parts.every((p) => desc.includes(p));
  });
}

async function scrapeCollege(
  slug: string,
  baseUrl: string,
  termName: string
): Promise<CourseSection[]> {
  console.log(`\nScraping ${slug} (${baseUrl}) for ${termName}...`);

  // Step 1: Get available terms
  const terms = await getTerms(baseUrl);
  const term = matchTerm(terms, termName);
  if (!term) {
    console.error(
      `  Term "${termName}" not found. Available: ${terms.map((t) => t.description).join(", ")}`
    );
    return [];
  }
  console.log(`  Using term: ${term.description} (${term.code})`);

  // Step 2: Create session and set term
  // First request to get session cookie
  const initResp = await fetch(
    `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`,
    { redirect: "manual" }
  );
  const initCookies = (initResp.headers.getSetCookie?.() || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const cookies = await setTerm(baseUrl, term.code, initCookies);

  // Step 3: Paginate through all raw sections
  const rawSections: BannerSection[] = [];
  let offset = 0;
  let totalCount = 0;

  do {
    const result = await searchSections(baseUrl, term.code, offset, cookies);
    totalCount = result.totalCount;

    if (!result.data || result.data.length === 0) break;

    rawSections.push(...result.data);

    console.log(
      `  Fetched ${rawSections.length}/${totalCount} sections...`
    );
    offset += PAGE_SIZE;

    if (offset < totalCount) {
      await sleep(DELAY_MS);
    }
  } while (offset < totalCount);

  // Step 4: Fetch prerequisites
  const subjectMap = await buildSubjectMap(baseUrl, term.code, cookies);
  const prereqs = await fetchPrerequisites(baseUrl, term.code, rawSections, cookies, subjectMap);
  const withPrereqs = prereqs.size;
  console.log(`  Found prerequisites for ${withPrereqs} courses`);

  // Step 5: Map sections with prereq data
  const termCode = normalizeTermCode(term, termName);
  const allSections: CourseSection[] = rawSections.map((s) => {
    const courseKey = `${s.subject} ${s.courseNumber}`;
    return mapSection(slug, termCode, s, prereqs.get(courseKey));
  });

  return allSections;
}

/** Convert Banner term to standard YYYYSS format */
function normalizeTermCode(
  term: BannerTerm,
  termName: string
): string {
  const yearMatch = termName.match(/(\d{4})/);
  const seasonMatch = termName.match(/(spring|summer|fall)/i);
  if (yearMatch && seasonMatch) {
    const season = seasonMatch[1].toLowerCase();
    const code =
      season === "spring" ? "SP" : season === "summer" ? "SU" : "FA";
    return `${yearMatch[1]}${code}`;
  }
  // Fallback: extract from Banner code (e.g., 202610 → 2026FA)
  const y = term.code.slice(0, 4);
  const s = term.code.slice(4, 6);
  const seasonMap: Record<string, string> = {
    "10": "FA",
    "20": "SP",
    "30": "SU",
  };
  return `${y}${seasonMap[s] || s}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const termIdx = args.indexOf("--term");
  const isAll = args.includes("--all");

  const termName = termIdx >= 0 ? args[termIdx + 1] : "Fall 2026";

  let targets: [string, string][];
  if (isAll) {
    targets = Object.entries(BANNER_COLLEGES);
  } else if (collegeIdx >= 0) {
    const slug = args[collegeIdx + 1];
    const url = BANNER_COLLEGES[slug];
    if (!url) {
      console.error(`Unknown college: ${slug}`);
      console.error(`Available: ${Object.keys(BANNER_COLLEGES).join(", ")}`);
      process.exit(1);
    }
    targets = [[slug, url]];
  } else {
    console.log(
      "Usage:\n" +
        '  npx tsx scripts/sc/scrape-banner.ts --college piedmont\n' +
        '  npx tsx scripts/sc/scrape-banner.ts --college piedmont --term "Fall 2026"\n' +
        "  npx tsx scripts/sc/scrape-banner.ts --all"
    );
    return;
  }

  console.log(`Scraping ${targets.length} college(s) for ${termName}...`);

  for (const [slug, baseUrl] of targets) {
    try {
      const sections = await scrapeCollege(slug, baseUrl, termName);

      if (sections.length > 0) {
        const termCode = sections[0].term;
        const outDir = path.join(
          process.cwd(),
          "data",
          "sc",
          "courses",
          slug
        );
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `${termCode}.json`);
        fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
        console.log(
          `\n  Written ${sections.length} sections to ${outPath}`
        );
      } else {
        console.log(`\n  No sections found for ${slug}`);
      }
    } catch (err) {
      console.error(`\n  Error scraping ${slug}:`, err);
    }

    await sleep(DELAY_MS);
  }

  // Auto-import into Supabase (skip with --no-import)
  if (!args.includes("--no-import")) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("sc");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
