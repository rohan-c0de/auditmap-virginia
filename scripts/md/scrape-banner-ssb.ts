/**
 * scrape-banner-ssb.ts
 *
 * Scrapes course section data from Maryland community colleges that use
 * Ellucian Banner 9/10 Student Registration SSB REST API.
 * Adapted from the DC Banner scraper.
 *
 * Covers: Harford CC, Montgomery College
 *
 * Usage:
 *   npx tsx scripts/md/scrape-banner-ssb.ts --college harford
 *   npx tsx scripts/md/scrape-banner-ssb.ts --all
 */

import fs from "fs";
import path from "path";

const PAGE_SIZE = 500;

// MD Banner SSB colleges
const BANNER_COLLEGES: Record<string, string> = {
  harford: "https://banner.harford.edu",
  montgomery: "https://b9pubstu.glb.montgomerycollege.edu",
};

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

function bannerTermToStandard(code: string): string {
  // Common Banner term code patterns:
  // 202620 = Spring 2026, 202630 = Summer 2026, 202710 = Fall 2026
  // Some schools use: 202601 = Spring, 202602 = Summer, 202603 = Fall
  const year = parseInt(code.substring(0, 4));
  const suffix = code.substring(4);
  if (suffix === "10") return `${year - 1}FA`;
  if (suffix === "20") return `${year}SP`;
  if (suffix === "30") return `${year}SU`;
  if (suffix === "01") return `${year}SP`;
  if (suffix === "02") return `${year}SU`;
  if (suffix === "03") return `${year}FA`;
  // Fallback: try to guess from description
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

function detectMode(
  mt: BannerSection["meetingsFaculty"][0]["meetingTime"],
  campus: string
): string {
  const campusLower = (campus || "").toLowerCase();
  const buildingLower = (mt.buildingDescription || "").toLowerCase();
  if (
    campusLower.includes("online") ||
    buildingLower.includes("online") ||
    buildingLower.includes("virtual")
  ) {
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

// Prerequisite parsing
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

async function buildSubjectMap(
  baseUrl: string,
  termCode: string,
  cookies: string
): Promise<void> {
  try {
    const res = await fetch(
      `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${termCode}&offset=1&max=500`,
      { headers: { Cookie: cookies } }
    );
    const subjects: { code: string; description: string }[] = await res.json();
    for (const s of subjects) {
      SUBJECT_TO_PREFIX[s.description.toLowerCase()] = s.code;
    }
    console.log(
      `  Built subject map: ${Object.keys(SUBJECT_TO_PREFIX).length} subjects`
    );
  } catch {
    console.warn(
      "  Warning: Could not fetch subject map"
    );
  }
}

async function fetchPrerequisites(
  baseUrl: string,
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
            `${baseUrl}/StudentRegistrationSsb/ssb/searchResults/getSectionPrerequisites?term=${termCode}&courseReferenceNumber=${crn}`,
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

async function getTerms(baseUrl: string): Promise<BannerTerm[]> {
  const res = await fetch(
    `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30`
  );
  return res.json();
}

async function searchSections(
  baseUrl: string,
  termCode: string,
  cookies: string
): Promise<BannerSection[]> {
  const all: BannerSection[] = [];
  let offset = 0;

  while (true) {
    const url = `${baseUrl}/StudentRegistrationSsb/ssb/searchResults/searchResults?txt_term=${termCode}&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}&sortColumn=subjectDescription&sortDirection=asc`;
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

async function initSession(
  baseUrl: string,
  termCode: string
): Promise<string> {
  const res1 = await fetch(
    `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`,
    { redirect: "manual" }
  );
  const setCookies = res1.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  await fetch(
    `${baseUrl}/StudentRegistrationSsb/ssb/term/search?mode=search`,
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

async function scrapeCollege(slug: string, baseUrl: string): Promise<void> {
  console.log(`\n=== Scraping ${slug} (${baseUrl}) ===`);

  console.log("Fetching available terms...");
  const terms = await getTerms(baseUrl);

  // Filter to recent/upcoming terms
  const targetTerms = terms.filter((t) => {
    const code = parseInt(t.code);
    return code >= 202620;
  });

  console.log(
    `Found ${targetTerms.length} target terms:`,
    targetTerms.map((t) => t.description)
  );

  const outDir = path.join(process.cwd(), "data", "md", "courses", slug);
  fs.mkdirSync(outDir, { recursive: true });

  let totalSections = 0;

  for (const term of targetTerms) {
    const standardTerm = bannerTermToStandard(term.code);
    console.log(
      `\nScraping ${term.description} (${term.code} → ${standardTerm})...`
    );

    const cookies = await initSession(baseUrl, term.code);
    await buildSubjectMap(baseUrl, term.code, cookies);

    const sections = await searchSections(baseUrl, term.code, cookies);

    const prereqs = await fetchPrerequisites(
      baseUrl,
      term.code,
      sections,
      cookies
    );
    console.log(`  Found prerequisites for ${prereqs.size} courses`);

    const converted = sections.map((s) => {
      const mt = s.meetingsFaculty?.[0]?.meetingTime;
      const credits = s.creditHours ?? s.creditHourLow ?? 3;
      const campus =
        mt?.campusDescription || s.campusDescription || "";
      const mode = mt ? detectMode(mt, campus) : "online";
      const courseKey = `${s.subject} ${s.courseNumber}`;
      const prereq = prereqs.get(courseKey);

      return {
        college_code: slug,
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
    console.log(
      `  → ${converted.length} sections written to ${standardTerm}.json (${withPrereqs} with prereqs)`
    );
    totalSections += converted.length;
  }

  console.log(`\n${slug}: ${totalSections} total sections scraped.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const allFlag = args.includes("--all");

  let targets: [string, string][];

  if (allFlag) {
    targets = Object.entries(BANNER_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    const baseUrl = BANNER_COLLEGES[slug];
    if (!baseUrl) {
      console.error(`Unknown college: ${slug}`);
      console.error(
        `Available: ${Object.keys(BANNER_COLLEGES).join(", ")}`
      );
      process.exit(1);
    }
    targets = [[slug, baseUrl]];
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/md/scrape-banner-ssb.ts --college harford");
    console.log("  npx tsx scripts/md/scrape-banner-ssb.ts --all");
    process.exit(0);
  }

  for (const [slug, baseUrl] of targets) {
    await scrapeCollege(slug, baseUrl);
  }

  // Auto-import into Supabase
  if (!args.includes("--no-import")) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("md");
  }

  console.log("\nDone.");
}

main().catch(console.error);
