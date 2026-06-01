/**
 * City Colleges of Chicago (CCC) — shared course scraper
 *
 * Covers all 7 CCC colleges via a single JSON API endpoint:
 *   GET https://apps.ccc.edu/scheduling/api/getAvailableTerms
 *
 * Returns ~10-12k sections across all colleges in one response.
 * No authentication, no pagination, no rate limits observed.
 *
 * Campus codes → college slugs:
 *   DA → city-colleges-of-chicago-richard-j-daley-college
 *   HW → city-colleges-of-chicago-harold-washington-college
 *   KK → city-colleges-of-chicago-kennedy-king-college
 *   MX → city-colleges-of-chicago-malcolm-x-college
 *   OH → city-colleges-of-chicago-olive-harvey-college
 *   TR → city-colleges-of-chicago-harry-s-truman-college
 *   WR → city-colleges-of-chicago-wilbur-wright-college
 *
 * Term codes are 4-digit: 12XX where the last two digits encode
 * term + year in CCC's internal system. We group by term code and
 * map to human-readable term names (e.g. "2026SU", "2026FA").
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CCCRawSection {
  Campus: string;
  Term: string;
  CourseID: string;
  ClassNum: string;
  Subject: string;
  CatalogNum: string;
  Section: string;
  StartDt: string;
  EndDt: string;
  InstrID: string;
  InstrFirstName: string;
  InstrLastName: string;
  MtgStart: string;
  MtgEnd: string;
  Mon: string;
  Tues: string;
  Wed: string;
  Thur: string;
  Fri: string;
  Sat: string;
  Sun: string;
  CourseTitle: string;
  NumberOfWeeks: string;
  Description: string;
  MinUnit: string;
  MaxUnit: string;
  Room: string;
  IAIApproved: string;
  Session: string;
  SessionLongName: string;
  Component: string;
  AssociatedClass: string;
  CourseFee: string;
  SubjectDescr: string;
  EnrollmentReq: string;
  Notes: string;
  Location: string;
  HumanDiversity: string;
  GenEd: string;
  Enrollment: string;
  Modality: string;
  SpecialSession: string;
  ClassStatus: string;
  CampusCode: string;
  Dual: string;
  Async_Sync: string;
  SessionBeginDt: string;
  DeliveryMethod: string;
  SubCampus: string;
  LowTextBookCost: string;
  NoTextBookCost: string;
}

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
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = "https://apps.ccc.edu/scheduling/api/getAvailableTerms";

const CAMPUS_TO_SLUG: Record<string, string> = {
  DA: "city-colleges-of-chicago-richard-j-daley-college",
  HW: "city-colleges-of-chicago-harold-washington-college",
  KK: "city-colleges-of-chicago-kennedy-king-college",
  MX: "city-colleges-of-chicago-malcolm-x-college",
  OH: "city-colleges-of-chicago-olive-harvey-college",
  TR: "city-colleges-of-chicago-harry-s-truman-college",
  WR: "city-colleges-of-chicago-wilbur-wright-college",
};

const DATA_DIR = path.resolve(__dirname, "../../data/il/courses");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map CCC term code to a human-readable term string based on start dates.
 * CCC terms: examine the first section's StartDt to determine season.
 */
function termCodeToLabel(termCode: string, sections: CCCRawSection[]): string {
  const sample = sections.find((s) => s.Term === termCode);
  if (!sample) return termCode;

  // StartDt format: "MM-DD-YYYY"
  const [mm, , yyyy] = sample.StartDt.split("-");
  const month = parseInt(mm, 10);
  const year = yyyy;

  if (month >= 1 && month <= 2) return `${year}SP`; // Spring (Jan-Feb start)
  if (month >= 3 && month <= 5) return `${year}SP`; // Spring (Mar-May start, late spring)
  if (month >= 6 && month <= 7) return `${year}SU`; // Summer
  if (month >= 8 && month <= 10) return `${year}FA`; // Fall
  if (month >= 11) return `${year}FA`; // Late fall

  return `${year}`;
}

/**
 * Convert CCC date format "MM-DD-YYYY" to ISO "YYYY-MM-DD"
 */
function parseDate(cccDate: string): string {
  if (!cccDate || cccDate.trim().length === 0) return "";
  const [mm, dd, yyyy] = cccDate.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert CCC time format "H:MM" or "HH:MM" to 12-hour "H:MM AM/PM"
 */
function parseTime(cccTime: string): string {
  if (!cccTime || cccTime.trim().length === 0) return "";
  const parts = cccTime.trim().split(":");
  if (parts.length !== 2) return cccTime;

  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];

  if (isNaN(hours)) return cccTime;

  const ampm = hours >= 12 ? "PM" : "AM";
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;

  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Build days string from individual day flags
 */
function buildDays(raw: CCCRawSection): string {
  let days = "";
  if (raw.Mon) days += "M";
  if (raw.Tues) days += "T";
  if (raw.Wed) days += "W";
  if (raw.Thur) days += "R";
  if (raw.Fri) days += "F";
  if (raw.Sat) days += "S";
  if (raw.Sun) days += "U";
  return days;
}

/**
 * Map CCC modality to our standard mode enum
 */
function mapMode(raw: CCCRawSection): CourseSection["mode"] {
  const modality = (raw.Modality || "").toLowerCase();
  if (modality.includes("online")) {
    // "Online-live" (synchronous) → zoom, regular "Online" → online
    if (raw.Async_Sync?.trim() === "Synchronous" || modality.includes("live")) {
      return "zoom";
    }
    return "online";
  }
  if (modality.includes("hybrid") || modality.includes("blended")) {
    return "hybrid";
  }
  return "in-person";
}

/**
 * Parse enrollment requirement text into prerequisite_courses array.
 * Looks for patterns like "ENGLISH 101", "MATH 140", etc.
 */
function parsePrereqCourses(enrollmentReq: string): string[] {
  if (!enrollmentReq || enrollmentReq.trim().length === 0) return [];
  // Match "SUBJECT NNN" patterns (uppercase word + space + digits)
  const matches = enrollmentReq.match(/\b([A-Z]{2,})\s+(\d{3,4})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/\s+/, " ")))];
}

/**
 * Transform a raw CCC section into our canonical CourseSection format
 */
function transformSection(
  raw: CCCRawSection,
  collegeSlug: string,
  termLabel: string
): CourseSection {
  const instructor =
    raw.InstrFirstName && raw.InstrLastName
      ? `${raw.InstrLastName}, ${raw.InstrFirstName}`
      : null;

  return {
    college_code: collegeSlug,
    term: termLabel,
    course_prefix: raw.Subject.trim(),
    course_number: raw.CatalogNum.trim(),
    course_title: raw.CourseTitle.trim(),
    credits: parseFloat(raw.MaxUnit) || parseFloat(raw.MinUnit) || 0,
    crn: raw.ClassNum.trim(),
    days: buildDays(raw),
    start_time: parseTime(raw.MtgStart),
    end_time: parseTime(raw.MtgEnd),
    start_date: parseDate(raw.StartDt),
    location: raw.Room ? `${raw.Campus} ${raw.Room}`.trim() : raw.Campus,
    campus: raw.SubCampus || raw.Campus,
    mode: mapMode(raw),
    instructor,
    seats_open: raw.Enrollment === "Open" ? null : 0,
    seats_total: null,
    prerequisite_text: raw.EnrollmentReq?.trim() || null,
    prerequisite_courses: parsePrereqCourses(raw.EnrollmentReq),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noWrite = args.includes("--dry-run");
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🏙️  CCC Scraper — City Colleges of Chicago");
  console.log(`   Fetching ${API_URL} ...`);

  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${res.statusText}`);
  }

  const rawData: CCCRawSection[] = await res.json();
  console.log(`   Got ${rawData.length} total sections from API.`);

  // Filter to only active sections
  const active = rawData.filter(
    (s) => s.ClassStatus === "Active" && CAMPUS_TO_SLUG[s.CampusCode]
  );
  console.log(`   ${active.length} active sections across known campuses.`);

  // Determine term labels
  const termCodes = [...new Set(active.map((s) => s.Term))].sort();
  const termLabels: Record<string, string> = {};
  for (const code of termCodes) {
    termLabels[code] = termCodeToLabel(code, active);
  }
  console.log(
    `   Terms: ${termCodes.map((c) => `${c} → ${termLabels[c]}`).join(", ")}`
  );

  // Group by campus → term
  const byCampusTerm: Record<string, Record<string, CourseSection[]>> = {};

  for (const raw of active) {
    const slug = CAMPUS_TO_SLUG[raw.CampusCode];
    if (!slug) continue;
    if (collegeFilter && slug !== collegeFilter) continue;

    const termLabel = termLabels[raw.Term];
    if (!byCampusTerm[slug]) byCampusTerm[slug] = {};
    if (!byCampusTerm[slug][termLabel]) byCampusTerm[slug][termLabel] = [];

    byCampusTerm[slug][termLabel].push(transformSection(raw, slug, termLabel));
  }

  // Write output
  let totalWritten = 0;
  for (const [slug, terms] of Object.entries(byCampusTerm)) {
    for (const [termLabel, sections] of Object.entries(terms)) {
      const outDir = path.join(DATA_DIR, slug);
      const outFile = path.join(outDir, `${termLabel}.json`);

      if (noWrite) {
        console.log(
          `   [dry-run] ${slug}/${termLabel}.json — ${sections.length} sections`
        );
      } else {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
        console.log(
          `   ✓ ${slug}/${termLabel}.json — ${sections.length} sections`
        );
      }
      totalWritten += sections.length;
    }
  }

  console.log(
    `\n✅ Done — ${totalWritten} sections across ${Object.keys(byCampusTerm).length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ CCC scraper failed:", err.message);
  process.exit(1);
});
