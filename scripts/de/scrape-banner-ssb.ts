/**
 * scrape-banner-ssb.ts
 *
 * Scrapes course section data from Delaware Technical Community College (DTCC)
 * using Ellucian Banner 9 Student Registration SSB REST API.
 *
 * DTCC has a single public Banner SSB endpoint at banner.dtcc.edu that serves
 * all 4 campuses (Owens/Georgetown, Terry/Dover, Stanton/Newark, George/Wilmington).
 *
 * Usage:
 *   npx tsx scripts/de/scrape-banner-ssb.ts
 *   npx tsx scripts/de/scrape-banner-ssb.ts --list-terms
 *   npx tsx scripts/de/scrape-banner-ssb.ts --no-import
 */

import fs from "fs";
import path from "path";

const PAGE_SIZE = 500;
const BASE_URL = "https://banner.dtcc.edu";
const COLLEGE_SLUG = "dtcc";

interface BannerTerm {
  code: string;
  description: string;
}

interface BannerSection {
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
  scheduleTypeDescription: string;
  instructionalMethodDescription: string;
  faculty: { displayName: string; emailAddress?: string }[];
  meetingsFaculty: {
    meetingTime: {
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
    };
  }[];
  sectionAttributes: { description: string }[];
}

/**
 * DTCC uses standard Banner term codes:
 *   202652 = Spring 2026
 *   202642 = Fall 2025
 *   202632 = Summer 2025
 * Pattern: YYYY + semester suffix (52=Spring, 42=Fall, 32=Summer of previous academic year)
 * But we primarily parse the description for reliability.
 */
function bannerTermToStandard(code: string, description: string): string {
  const descLower = description.toLowerCase();

  // Extract year from description first, fall back to code
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.substring(0, 4);

  if (descLower.includes("fall")) return `${year}FA`;
  if (descLower.includes("spring") || descLower.includes("winter"))
    return `${year}SP`;
  if (descLower.includes("summer")) return `${year}SU`;

  // Fallback to DTCC code suffix: 51=Fall, 52=Spring, 53=Summer
  const suffix = code.substring(4);
  if (suffix === "51") return `${year}FA`;
  if (suffix === "52") return `${year}SP`;
  if (suffix === "53") return `${year}SU`;

  return `${year}XX`;
}

function formatTime(t: string | null): string {
  if (!t || t.length < 4) return "";
  const h = parseInt(t.substring(0, 2));
  const m = t.substring(2, 4);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}

function buildDays(
  mt: BannerSection["meetingsFaculty"][0]["meetingTime"]
): string {
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

function parseDate(d: string | null): string {
  if (!d) return "";
  const parts = d.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

/**
 * Normalize DTCC campus descriptions to standard campus names.
 * DTCC has 4 main campuses plus online.
 */
function normalizeCampus(campus: string): string {
  const c = (campus || "").toLowerCase();
  if (c.includes("owens") || c.includes("georgetown")) return "Owens";
  if (c.includes("terry") || c.includes("dover")) return "Terry";
  if (c.includes("stanton") || c.includes("newark") || c.includes("wilmington campus"))
    return "Stanton";
  if (c.includes("george") || c.includes("wilmington")) return "George";
  if (c.includes("online") || c.includes("virtual") || c.includes("distance"))
    return "Online";
  return campus || "Main";
}

function detectMode(
  mt: BannerSection["meetingsFaculty"][0]["meetingTime"],
  campus: string,
  instructionalMethod?: string
): string {
  const campusLower = (campus || "").toLowerCase();
  const buildingLower = (mt.buildingDescription || "").toLowerCase();
  const methodLower = (instructionalMethod || "").toLowerCase();

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
// ---------------------------------------------------------------------------

const SUBJECT_TO_PREFIX: Record<string, string> = {};

interface PrereqInfo {
  text: string;
  courses: string[];
}

function parsePrereqHtml(html: string): PrereqInfo | null {
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
    const prefix =
      SUBJECT_TO_PREFIX[row.subject.toLowerCase()] || row.subject;
    const courseCode = `${prefix} ${row.courseNum}`;
    const gradeNote =
      row.grade && row.grade !== "TR" ? ` (min ${row.grade})` : "";
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

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function buildSubjectMap(
  termCode: string,
  cookies: string
): Promise<void> {
  try {
    const res = await fetch(
      `${BASE_URL}/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${termCode}&offset=1&max=500`,
      { headers: { Cookie: cookies } }
    );
    const subjects: { code: string; description: string }[] = await res.json();
    Object.keys(SUBJECT_TO_PREFIX).forEach(
      (k) => delete SUBJECT_TO_PREFIX[k]
    );
    for (const s of subjects) {
      SUBJECT_TO_PREFIX[s.description.toLowerCase()] = s.code;
    }
    console.log(
      `  Built subject map: ${Object.keys(SUBJECT_TO_PREFIX).length} subjects`
    );
  } catch {
    console.warn("  Warning: Could not fetch subject map");
  }
}

async function fetchPrerequisites(
  termCode: string,
  sections: BannerSection[],
  cookies: string
): Promise<Map<string, PrereqInfo>> {
  const courseMap = new Map<string, string>();
  for (const s of sections) {
    const key = `${s.subject} ${s.courseNumber}`;
    if (!courseMap.has(key)) {
      courseMap.set(key, s.courseReferenceNumber);
    }
  }

  console.log(
    `  Fetching prerequisites for ${courseMap.size} unique courses...`
  );
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
            `${BASE_URL}/StudentRegistrationSsb/ssb/searchResults/getSectionPrerequisites?term=${termCode}&courseReferenceNumber=${crn}`,
            { headers: { Cookie: cookies } }
          );
          const html = await res.text();
          const info = parsePrereqHtml(html);
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
      console.log(
        `    prereqs: ${fetched}/${entries.length} (${prereqs.size} with prereqs)`
      );
    }
  }

  return prereqs;
}

async function getTerms(): Promise<BannerTerm[]> {
  const res = await fetch(
    `${BASE_URL}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30`
  );
  return res.json();
}

async function searchSections(
  termCode: string,
  cookies: string
): Promise<BannerSection[]> {
  const all: BannerSection[] = [];
  let offset = 0;

  while (true) {
    const url = `${BASE_URL}/StudentRegistrationSsb/ssb/searchResults/searchResults?txt_term=${termCode}&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}&sortColumn=subjectDescription&sortDirection=asc`;
    const res = await fetch(url, {
      headers: { Cookie: cookies },
    });
    const data = await res.json();

    if (!data.success || !data.data || data.data.length === 0) break;
    all.push(...data.data);
    console.log(`  fetched ${all.length}/${data.totalCount}`);

    if (all.length >= data.totalCount) break;
    offset += PAGE_SIZE;
  }

  return all;
}

async function initSession(termCode: string): Promise<string> {
  const res1 = await fetch(
    `${BASE_URL}/StudentRegistrationSsb/ssb/classSearch/classSearch`,
    { redirect: "manual" }
  );
  const setCookies = res1.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  await fetch(
    `${BASE_URL}/StudentRegistrationSsb/ssb/term/search?mode=search`,
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

// ---------------------------------------------------------------------------
// Main scraping logic
// ---------------------------------------------------------------------------

async function scrapeTerm(term: BannerTerm): Promise<number> {
  const standardTerm = bannerTermToStandard(term.code, term.description);
  console.log(
    `\n  Scraping ${term.description} (${term.code} → ${standardTerm})...`
  );

  try {
    const cookies = await initSession(term.code);
    await buildSubjectMap(term.code, cookies);

    const sections = await searchSections(term.code, cookies);

    if (sections.length === 0) {
      console.log(`  No sections found for ${term.description}`);
      return 0;
    }

    const prereqs = await fetchPrerequisites(term.code, sections, cookies);
    console.log(`  Found prerequisites for ${prereqs.size} courses`);

    const converted = sections.map((s) => {
      const mt = s.meetingsFaculty?.[0]?.meetingTime;
      const credits = s.creditHours ?? s.creditHourLow ?? 3;
      const rawCampus =
        mt?.campusDescription || s.campusDescription || "";
      const campus = normalizeCampus(rawCampus);
      const mode = mt
        ? detectMode(mt, rawCampus, s.instructionalMethodDescription)
        : "online";
      const courseKey = `${s.subject} ${s.courseNumber}`;
      const prereq = prereqs.get(courseKey);

      return {
        college_code: COLLEGE_SLUG,
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
    });

    const outDir = path.join(
      process.cwd(),
      "data",
      "de",
      "courses",
      COLLEGE_SLUG
    );
    fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outFile, JSON.stringify(converted, null, 2));
    const withPrereqs = converted.filter((c) => c.prerequisite_text).length;
    console.log(
      `  → ${converted.length} sections written to ${standardTerm}.json (${withPrereqs} with prereqs)`
    );
    return converted.length;
  } catch (e) {
    console.error(`  Error scraping ${term.description}: ${e}`);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);

  console.log(`\n=== DTCC Banner SSB Scraper ===`);
  console.log(`  Endpoint: ${BASE_URL}`);

  let terms: BannerTerm[];
  try {
    console.log("  Fetching available terms...");
    terms = await getTerms();
  } catch (e) {
    console.error(`  ERROR: Could not connect to ${BASE_URL}: ${e}`);
    process.exit(1);
  }

  // --list-terms mode
  if (args.includes("--list-terms")) {
    console.log(`\nAvailable terms:`);
    for (const t of terms) {
      const std = bannerTermToStandard(t.code, t.description);
      console.log(`  ${t.code}: ${t.description} → ${std}`);
    }
    return;
  }

  // Filter to recent/upcoming terms (2026+)
  // "View Only" terms still have data — they're just past the registration window
  const targetTerms = terms.filter((t) => {
    const desc = t.description.toLowerCase();
    // Skip continuing education or non-credit terms
    if (desc.includes("continuing ed") || desc.includes("non-credit"))
      return false;
    // Extract year from description
    const yearMatch = t.description.match(/\b(20\d{2})\b/);
    if (yearMatch) return parseInt(yearMatch[1]) >= 2026;
    // Fallback: code-based year
    const codeYear = parseInt(t.code.substring(0, 4));
    return codeYear >= 2026;
  });

  if (targetTerms.length === 0) {
    console.log(
      `  No recent terms found. Available: ${terms.map((t) => `${t.description} (${t.code})`).join(", ")}`
    );
    return;
  }

  console.log(
    `  Found ${targetTerms.length} target terms:`,
    targetTerms.map((t) => t.description)
  );

  let grandTotal = 0;
  const results: { term: string; count: number }[] = [];

  for (const term of targetTerms) {
    const count = await scrapeTerm(term);
    const std = bannerTermToStandard(term.code, term.description);
    results.push({ term: std, count });
    grandTotal += count;
  }

  // Summary
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.term}: ${r.count} sections`);
  }
  console.log(`  Total: ${grandTotal} sections`);

  // Auto-import into Supabase
  if (!args.includes("--no-import") && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("de");
  }

  console.log("\nDone.");
}

main().catch(console.error);
