/**
 * scrape-banner-ssb.ts
 *
 * Scrapes course section data from Tennessee Board of Regents (TBR) community
 * colleges that use Ellucian Banner 9 Student Registration SSB REST API.
 *
 * 12 of the 13 TBR community colleges expose Banner 9 SSB publicly. Roane
 * State migrated registration to Ellucian Experience (myraidernet.roanestate.edu)
 * which requires SAML auth, so it is excluded here. Their public schedule
 * still uses Banner 8 (different protocol) and would need a separate scraper.
 *
 * Usage:
 *   npx tsx scripts/tn/scrape-banner-ssb.ts --college columbia-state
 *   npx tsx scripts/tn/scrape-banner-ssb.ts --all
 */

// WARNING: Disables TLS verification globally. Required because some TBR
// colleges have self-signed or expired SSL certs. Re-enable before any
// non-scrape network calls if this script is extended.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import fs from "fs";
import path from "path";

const PAGE_SIZE = 500;

// 12 TBR community colleges with publicly scrapable Banner 9 SSB endpoints.
// Hostnames vary by college (no shared subdomain pattern like GA's bannerss.*).
// Roane State is excluded — see file header.
const BANNER_COLLEGES: Record<string, string> = {
  "chattanooga-state": "https://blss.chattanoogastate.edu",
  "cleveland-state": "https://ban-sserv.clevelandstatecc.edu",
  "columbia-state": "https://ssb.columbiastate.edu",
  "dyersburg-state": "https://ssbprd.dscc.edu",
  "jackson-state": "https://ssbprod.jscc.edu",
  "motlow-state": "https://prodssb.mscc.edu",
  "nashville-state": "https://pnsmss.nscc.edu",
  "northeast-state": "https://ssb.northeaststate.edu",
  "pellissippi-state": "https://ssbprod.pstcc.edu",
  "southwest-tn": "https://mafa1033ssbp.southwest.tn.edu",
  "volunteer-state": "https://ssb.volstate.edu",
  "walters-state": "https://prodssb.ws.edu",
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
  // TBR uses calendar-year codes: YYYY10 = Spring, YYYY50 = Summer, YYYY80 = Fall.
  // Descriptions are clean ("Fall 2026", "Spring Credit Term 2026"), so prefer
  // description-based parsing and fall back to code parsing only if needed.
  const descLower = description.toLowerCase();

  // Extract year from description first, fall back to code prefix
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.substring(0, 4);

  if (descLower.includes("fall")) return `${year}FA`;
  if (descLower.includes("spring") || descLower.includes("winter")) return `${year}SP`;
  if (descLower.includes("summer")) return `${year}SU`;

  // Fallback to code-based parsing (TBR calendar-year convention)
  const codeYear = parseInt(code.substring(0, 4));
  const suffix = code.substring(4);
  if (suffix === "10") return `${codeYear}SP`;
  if (suffix === "50") return `${codeYear}SU`;
  if (suffix === "80") return `${codeYear}FA`;
  return `${year}XX`;
}

// TBR Banner instances also expose TCAT (Tennessee Colleges of Applied
// Technology) terms — those use suffix 19/59/89 and are NOT community college
// credit terms. Filter them out, along with past "(View Only)" terms.
function isCreditTerm(term: BannerTerm): boolean {
  if (term.description.includes("View Only")) return false;
  if (term.description.toUpperCase().includes("TCAT")) return false;
  const suffix = term.code.substring(4);
  return suffix === "10" || suffix === "50" || suffix === "80";
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

/**
 * Load the Pellissippi-sourced catalog prereq map as a fallback for when
 * Banner's `getSectionPrerequisites` returns empty HTML (which is the case
 * for ~97% of TBR sections — see scripts/tn/scrape-catalog-prereqs.ts for
 * the scrape and the rationale for using Pellissippi as the TBR-wide
 * authoritative source via common course numbering).
 *
 * Returns an empty Map on read failure so the scrape can still run if the
 * static JSON is missing (e.g. fresh checkout that hasn't run the catalog
 * scraper yet).
 */
function loadCatalogPrereqs(): Map<string, PrereqInfo> {
  const jsonPath = path.join(process.cwd(), "data", "tn", "prereqs.json");
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<
      string,
      PrereqInfo
    >;
    const map = new Map<string, PrereqInfo>();
    for (const [key, value] of Object.entries(raw)) {
      map.set(key, value);
    }
    return map;
  } catch (e) {
    console.warn(`  Warning: could not load ${jsonPath}: ${e}`);
    return new Map();
  }
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
    // Reset for each college
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

async function scrapeCollege(slug: string, baseUrl: string): Promise<number> {
  console.log(`\n=== Scraping ${slug} (${baseUrl}) ===`);

  let terms: BannerTerm[];
  try {
    console.log("  Fetching available terms...");
    terms = await getTerms(baseUrl);
  } catch (e) {
    console.error(`  ERROR: Could not connect to ${baseUrl}: ${e}`);
    console.error(`  Skipping ${slug} — the Banner URL may need verification.`);
    return 0;
  }

  // Filter to current/upcoming credit terms (skip TCAT and "View Only" past terms).
  // TBR calendar codes: Spring 2026 = 202610, Summer 2026 = 202650, Fall 2026 = 202680.
  const minCode = 202610;
  const targetTerms = terms.filter((t) => {
    if (!isCreditTerm(t)) return false;
    return parseInt(t.code) >= minCode;
  });

  if (targetTerms.length === 0) {
    console.log(`  No recent credit terms found. Available: ${terms.map((t) => `${t.description} (${t.code})`).join(", ")}`);
    return 0;
  }

  console.log(
    `  Found ${targetTerms.length} target terms:`,
    targetTerms.map((t) => t.description)
  );

  const outDir = path.join(process.cwd(), "data", "tn", "courses", slug);
  fs.mkdirSync(outDir, { recursive: true });

  // Load the Pellissippi-sourced TBR catalog prereqs once per college. This
  // file is applied TBR-system-wide because TBR enforces common course
  // numbering (ENGL 1010, MATH 1530 etc. share catalog descriptions across
  // all 13 colleges). See scripts/tn/scrape-catalog-prereqs.ts.
  const catalogPrereqs = loadCatalogPrereqs();
  if (catalogPrereqs.size > 0) {
    console.log(
      `  Loaded ${catalogPrereqs.size} TBR catalog prereqs (fallback for empty Banner prereqs)`
    );
  }

  let totalSections = 0;

  for (const term of targetTerms) {
    const standardTerm = bannerTermToStandard(term.code, term.description);
    console.log(
      `\n  Scraping ${term.description} (${term.code} → ${standardTerm})...`
    );

    try {
      const cookies = await initSession(baseUrl, term.code);
      await buildSubjectMap(baseUrl, term.code, cookies);

      const sections = await searchSections(baseUrl, term.code, cookies);

      if (sections.length === 0) {
        console.log(`  No sections found for ${term.description}`);
        continue;
      }

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
        // Banner prereq wins when present (~3% of TBR sections). Fall back
        // to the Pellissippi catalog prereq when Banner returns nothing —
        // this jumps coverage from ~3% to ~70% of sections.
        const prereq = prereqs.get(courseKey) ?? catalogPrereqs.get(courseKey);

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
      const withPrereqs = converted.filter(
        (c) => c.prerequisite_text
      ).length;
      console.log(
        `  → ${converted.length} sections written to ${standardTerm}.json (${withPrereqs} with prereqs)`
      );
      totalSections += converted.length;
    } catch (e) {
      console.error(`  Error scraping ${term.description}: ${e}`);
    }
  }

  console.log(`\n  ${slug}: ${totalSections} total sections scraped.`);
  return totalSections;
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
    console.log(
      "  npx tsx scripts/tn/scrape-banner-ssb.ts --college columbia-state"
    );
    console.log("  npx tsx scripts/tn/scrape-banner-ssb.ts --all");
    process.exit(0);
  }

  let grandTotal = 0;
  const results: { slug: string; count: number }[] = [];

  for (const [slug, baseUrl] of targets) {
    const count = await scrapeCollege(slug, baseUrl);
    results.push({ slug, count });
    grandTotal += count;
  }

  // Summary
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.count} sections`);
  }
  console.log(`  Total: ${grandTotal} sections across ${results.length} colleges`);

  // Auto-import into Supabase
  if (!args.includes("--no-import") && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("tn");
  }

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
