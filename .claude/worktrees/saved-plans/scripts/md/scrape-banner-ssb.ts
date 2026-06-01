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
import { pickRecentSsbTerms } from "../lib/resolve-terms";
import { fetchWithRetry } from "../lib/http-retry";

const PAGE_SIZE = 500;

// MD Banner SSB colleges
const BANNER_COLLEGES: Record<string, string> = {
  harford: "https://banner.harford.edu",
  montgomery: "https://b9pubstu.glb.montgomerycollege.edu",
  // Added via coverage-expansion + refingerprint workflow:
  bccc: "https://bccc-prod-pxes02.banner.elluciancloud.com:8090",
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

function bannerTermToStandard(code: string, description: string): string {
  // Different schools use wildly different term code conventions,
  // so we primarily parse the description and use the code only for the year.
  const descLower = description.toLowerCase();

  // Extract year from description first, fall back to code prefix
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.substring(0, 4);

  if (descLower.includes("fall")) return `${year}FA`;
  if (descLower.includes("spring") || descLower.includes("winter")) return `${year}SP`;
  if (descLower.includes("summer")) return `${year}SU`;

  // Fallback to code-based parsing
  const codeYear = parseInt(code.substring(0, 4));
  const suffix = code.substring(4);
  if (suffix === "10") return `${codeYear - 1}FA`;
  if (suffix === "20") return `${codeYear}SP`;
  if (suffix === "30") return `${codeYear}SU`;
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
    const res = await fetchWithRetry(
      `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${termCode}&offset=1&max=500`,
      { headers: { Cookie: cookies } },
      { label: `subjects(${baseUrl})` }
    );
    const subjects: { code: string; description: string }[] = await res.json();
    // Clear stale entries from previous colleges
    Object.keys(SUBJECT_TO_PREFIX).forEach(k => delete SUBJECT_TO_PREFIX[k]);
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
          const res = await fetchWithRetry(
            `${baseUrl}/StudentRegistrationSsb/ssb/searchResults/getSectionPrerequisites?term=${termCode}&courseReferenceNumber=${crn}`,
            { headers: { Cookie: cookies } },
            { label: `prereqs(${crn})`, attempts: 2 }
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
  const res = await fetchWithRetry(
    `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30`,
    {},
    { label: `getTerms(${baseUrl})` }
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
    const res = await fetchWithRetry(
      url,
      { headers: { Cookie: cookies } },
      { label: `sections(${baseUrl}, offset=${offset})` }
    );
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
  const res1 = await fetchWithRetry(
    `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`,
    { redirect: "manual" },
    { label: `initSession.classSearch(${baseUrl})` }
  );
  const setCookies = res1.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  await fetchWithRetry(
    `${baseUrl}/StudentRegistrationSsb/ssb/term/search?mode=search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
      },
      body: `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
    },
    { label: `initSession.term(${baseUrl})` }
  );

  return cookies;
}

async function scrapeCollege(slug: string, baseUrl: string): Promise<void> {
  console.log(`\n=== Scraping ${slug} (${baseUrl}) ===`);

  console.log("Fetching available terms...");
  const terms = await getTerms(baseUrl);

  const targetTerms = pickRecentSsbTerms(terms);

  console.log(
    `Found ${targetTerms.length} target terms:`,
    targetTerms.map((t) => t.description)
  );

  const outDir = path.join(process.cwd(), "data", "md", "courses", slug);
  fs.mkdirSync(outDir, { recursive: true });

  let totalSections = 0;

  for (const term of targetTerms) {
    const standardTerm = bannerTermToStandard(term.code, term.description);
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
    // Guard against silently overwriting good data with an empty result —
    // CLAUDE.md invariant #4. If the source returned 0 sections but the
    // previous scrape had data, treat this run as a transient failure and
    // skip the write so the existing file stays intact.
    if (converted.length === 0 && fs.existsSync(outFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(outFile, "utf-8"));
        if (Array.isArray(prev) && prev.length > 0) {
          console.warn(
            `  ⚠ ${standardTerm}: scraper returned 0 sections but existing file has ${prev.length}; keeping previous data`
          );
          continue;
        }
      } catch {
        // Existing file unreadable — fall through and write the empty result
      }
    }
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
    // Default: scrape all Banner SSB colleges. Matches scrape-banner8.ts and
    // scrape-custom.ts so the unified scheduled-scrape workflow can invoke
    // this script with --no-import alone.
    targets = Object.entries(BANNER_COLLEGES);
  }

  // Per-college isolation: a durable outage at one source (issue #161 —
  // Harford Banner) must not abandon every later college's data. We log
  // the failure and continue. The scraper exits non-zero only if every
  // college failed; partial success keeps the workflow's `set -e` loop
  // moving on to the next script (banner8, custom).
  const failed: { slug: string; error: string }[] = [];
  for (const [slug, baseUrl] of targets) {
    try {
      await scrapeCollege(slug, baseUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`\n[!] ${slug} failed: ${msg}`);
      failed.push({ slug, error: msg });
    }
  }

  const successCount = targets.length - failed.length;

  // Auto-import into Supabase
  if (!args.includes("--no-import") && successCount > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("md");
  }

  console.log(
    `\nDone. ${successCount}/${targets.length} colleges scraped successfully.`
  );
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((f) => f.slug).join(", ")}`);
  }
  if (successCount === 0) {
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
