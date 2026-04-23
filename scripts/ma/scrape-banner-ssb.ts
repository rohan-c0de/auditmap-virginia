/**
 * Holyoke Community College course scraper — Banner SSB 9 REST API
 * Base URL: https://ban.hcc.edu
 *
 * Cloned from scripts/dc/scrape-banner.ts (UDC) — same SSB 9 REST pattern,
 * different term-code convention (HCC: 202630=Fall 2026, vs UDC's 202710=Fall 2026),
 * so this version uses description-based term mapping (matches MD's approach).
 *
 * Usage: npx tsx scripts/ma/scrape-banner-ssb.ts
 */

import fs from "fs";
import path from "path";

const BASE_URL = "https://ban.hcc.edu";
const COLLEGE_SLUG = "hcc";
const STATE_SLUG = "ma";
const PAGE_SIZE = 500;

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
  faculty: { displayName: string }[];
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
}

// Description-based mapping — more robust than code-suffix arithmetic across
// Banner tenants. HCC uses a different convention than UDC: 202630 = Fall 2026.
function bannerTermToStandard(code: string, description: string): string {
  const desc = description.toLowerCase();
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.substring(0, 4);
  if (desc.includes("fall")) return `${year}FA`;
  if (desc.includes("spring") || desc.includes("winter")) return `${year}SP`;
  if (desc.includes("summer")) return `${year}SU`;
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

function buildDays(mt: BannerSection["meetingsFaculty"][0]["meetingTime"]): string {
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
  // Banner date format: MM/DD/YYYY → YYYY-MM-DD
  const parts = d.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Prerequisite fetching
// ---------------------------------------------------------------------------

interface PrereqInfo {
  text: string;       // e.g. "ACCT 201 (min C) or ACCT 201C (min C)"
  courses: string[];  // e.g. ["ACCT 201", "ACCT 201C"]
}

/** Map from subject prefix code to full subject name in Banner (populated during scrape) */
const SUBJECT_TO_PREFIX: Record<string, string> = {};

function parsePrereqHtml(html: string): PrereqInfo | null {
  // Check for "No prerequisite"
  if (html.includes("No prerequisite")) return null;

  const rows: { andOr: string; subject: string; courseNum: string; grade: string }[] = [];
  // Match table rows: each <tr> has tds for And/Or, empty, Test, Score, Subject, CourseNumber, Level, Grade, empty
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

  // Convert subject names back to prefixes and build text
  const courses: string[] = [];
  const parts: string[] = [];
  for (const row of rows) {
    // Find prefix for subject name (e.g. "Accounting" -> "ACCT")
    const prefix = SUBJECT_TO_PREFIX[row.subject.toLowerCase()] || row.subject;
    const courseCode = `${prefix} ${row.courseNum}`;
    const gradeNote = row.grade && row.grade !== "TR" ? ` (min ${row.grade})` : "";
    const connector = row.andOr ? ` ${row.andOr.toLowerCase()} ` : "";

    if (connector && parts.length > 0) {
      parts.push(connector);
    }
    parts.push(`${courseCode}${gradeNote}`);

    // Only add unique course codes (skip TR duplicates)
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
  termCode: string,
  sections: BannerSection[],
  cookies: string
): Promise<Map<string, PrereqInfo>> {
  // Build subject name → prefix mapping from sections
  for (const s of sections) {
    // Banner gives us subjectDescription in sections — we need to get it
    // For now, use the subject code directly since our HTML has full names
    // We'll build the reverse map from the prereq data
  }

  // Deduplicate: one CRN per unique course
  const courseMap = new Map<string, string>(); // "SUBJ NUM" → CRN
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
      console.log(`    prereqs: ${fetched}/${entries.length} (${prereqs.size} with prereqs)`);
    }
  }

  return prereqs;
}

// ---------------------------------------------------------------------------
// Subject name mapping — Banner prereq HTML uses full names like "Accounting"
// We need to build a reverse map. Fetch it from the search API.
// ---------------------------------------------------------------------------

async function buildSubjectMap(termCode: string, cookies: string): Promise<void> {
  try {
    const res = await fetch(
      `${BASE_URL}/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${termCode}&offset=1&max=500`,
      { headers: { Cookie: cookies } }
    );
    const subjects: { code: string; description: string }[] = await res.json();
    // Clear stale entries from previous colleges
    Object.keys(SUBJECT_TO_PREFIX).forEach(k => delete SUBJECT_TO_PREFIX[k]);
    for (const s of subjects) {
      SUBJECT_TO_PREFIX[s.description.toLowerCase()] = s.code;
    }
    console.log(`  Built subject map: ${Object.keys(SUBJECT_TO_PREFIX).length} subjects`);
  } catch (e) {
    console.warn("  Warning: Could not fetch subject map, prereq names may use full names");
  }
}

function detectMode(mt: BannerSection["meetingsFaculty"][0]["meetingTime"], campus: string): string {
  const campusLower = (campus || "").toLowerCase();
  const buildingLower = (mt.buildingDescription || "").toLowerCase();
  if (campusLower.includes("online") || buildingLower.includes("online") || buildingLower.includes("virtual")) {
    return "online";
  }
  if (campusLower.includes("zoom") || buildingLower.includes("zoom")) {
    return "zoom";
  }
  if (campusLower.includes("hybrid") || buildingLower.includes("hybrid")) {
    return "hybrid";
  }
  return "in-person";
}

async function getTerms(): Promise<BannerTerm[]> {
  const res = await fetch(
    `${BASE_URL}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30`
  );
  return res.json();
}

async function searchSections(termCode: string, cookies: string): Promise<BannerSection[]> {
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
  // Step 1: GET classSearch page to get session cookie
  const res1 = await fetch(`${BASE_URL}/StudentRegistrationSsb/ssb/classSearch/classSearch`, {
    redirect: "manual",
  });
  const setCookies = res1.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  // Step 2: POST term selection
  await fetch(`${BASE_URL}/StudentRegistrationSsb/ssb/term/search?mode=search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });

  return cookies;
}

async function main() {
  console.log("Fetching available terms...");
  const terms = await getTerms();

  // Filter to recent/upcoming terms, skip non-credit and view-only
  const targetTerms = terms.filter((t) => {
    const desc = t.description.toLowerCase();
    if (desc.includes("view only") || desc.includes("noncredit")) return false;
    const yearMatch = t.description.match(/\b(20\d{2})\b/);
    return yearMatch ? parseInt(yearMatch[1]) >= 2026 : false;
  });

  console.log(`Found ${targetTerms.length} target terms:`, targetTerms.map((t) => t.description));

  const outDir = path.join(process.cwd(), "data", STATE_SLUG, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let totalSections = 0;

  for (const term of targetTerms) {
    const standardTerm = bannerTermToStandard(term.code, term.description);
    console.log(`\nScraping ${term.description} (${term.code} → ${standardTerm})...`);

    const cookies = await initSession(term.code);

    // Build subject name → prefix map (needed for prereq parsing)
    await buildSubjectMap(term.code, cookies);

    const sections = await searchSections(term.code, cookies);

    // Fetch prerequisites
    const prereqs = await fetchPrerequisites(term.code, sections, cookies);
    console.log(`  Found prerequisites for ${prereqs.size} courses`);

    const converted = sections.map((s) => {
      const mt = s.meetingsFaculty?.[0]?.meetingTime;
      const credits = s.creditHours ?? s.creditHourLow ?? 3;
      const campus = mt?.campusDescription || s.campusDescription || "";
      const mode = mt ? detectMode(mt, campus) : "online";
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
        campus: campus || "Main",
        mode,
        instructor: s.faculty?.[0]?.displayName || null,
        seats_open: s.seatsAvailable,
        seats_total: s.maximumEnrollment,
        prerequisite_text: prereq?.text || null,
        prerequisite_courses: prereq?.courses || [],
      };
    });

    const outFile = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outFile, JSON.stringify(converted, null, 2));
    const withPrereqs = converted.filter((c) => c.prerequisite_text).length;
    console.log(`  → ${converted.length} sections written to ${standardTerm}.json (${withPrereqs} with prereqs)`);
    totalSections += converted.length;
  }

  // Auto-import into Supabase (skip with --no-import)
  if (!process.argv.includes("--no-import")) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE_SLUG);
  }

  console.log(`\nDone! ${totalSections} total sections across ${targetTerms.length} terms.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
