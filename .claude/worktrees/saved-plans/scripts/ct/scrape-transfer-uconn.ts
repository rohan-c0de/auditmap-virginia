/**
 * scrape-transfer-uconn.ts
 *
 * Scrapes University of Connecticut's transfer course equivalency API to
 * extract CT State CC -> UConn mappings.
 *
 * UConn exposes a public REST API (no auth required):
 *   Base: https://admissions.uconn.edu/wp-json/uconn/v1/transfer-credits
 *   GET /schools                               → array of school name strings
 *   GET /schools/{school}?get-subjects         → array of {ext_subject} objects
 *   GET /subjects/{SUBJECT}?school={school}    → array of equivalency records
 *
 * Strategy:
 *   1. Fetch the school list, find "Connecticut State Community College"
 *   2. Fetch all subjects for that school
 *   3. For each subject, fetch all equivalency records
 *   4. Deduplicate and merge into data/ct/transfer-equiv.json
 *
 * Usage:
 *   npx tsx scripts/ct/scrape-transfer-uconn.ts
 *   npx tsx scripts/ct/scrape-transfer-uconn.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL =
  "https://admissions.uconn.edu/wp-json/uconn/v1/transfer-credits";
const SCHOOL_NAME = "Connecticut State Community College";
const UNIVERSITY_SLUG = "uconn";
const UNIVERSITY_DISPLAY = "University of Connecticut";

/** Delay between subject-level API calls to be polite to the server. */
const DELAY_MS = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: number;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: number;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

/** Raw record returned by the UConn /subjects/{SUBJECT} endpoint. */
interface UConnRecord {
  school: string;
  ext_subject: string;
  ext_number: string;
  int_subject?: string;
  int_number?: string;
  int_title?: string;
  ext_classes?: string[];
  int_classCodes?: string[];
  int_classTitles?: string[];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch<T>(
  url: string,
  label: string,
  attempts = 3,
): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; cc-coursemap-scraper/1.0; +https://communitycollegepath.com)",
        },
      });
      if (res.ok) {
        return (await res.json()) as T;
      }
      if (res.status === 404) {
        // Not an error — this subject just has no results for this school
        return null;
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(500 * Math.pow(2, i));
        continue;
      }
      console.warn(`  ${label}: unexpected HTTP ${res.status}`);
      return null;
    } catch (e) {
      lastErr = e;
      await sleep(500 * Math.pow(2, i));
    }
  }
  console.error(`  ${label} failed after ${attempts} attempts: ${lastErr}`);
  return null;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fetchSchools(): Promise<string[]> {
  const url = `${BASE_URL}/schools`;
  const data = await retryFetch<string[]>(url, "schools");
  return data ?? [];
}

async function fetchSubjects(schoolName: string): Promise<string[]> {
  const encoded = encodeURIComponent(schoolName);
  const url = `${BASE_URL}/schools/${encoded}?get-subjects`;
  const data = await retryFetch<{ ext_subject: string }[]>(url, "subjects");
  if (!data) return [];
  return data.map((s) => s.ext_subject).filter(Boolean);
}

async function fetchEquivalencies(
  subject: string,
  schoolName: string,
): Promise<UConnRecord[]> {
  const encodedSubject = encodeURIComponent(subject);
  const encodedSchool = encodeURIComponent(schoolName);
  const url = `${BASE_URL}/subjects/${encodedSubject}?school=${encodedSchool}`;
  const data = await retryFetch<UConnRecord[]>(
    url,
    `subject(${subject})`,
  );
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Mapping conversion
// ---------------------------------------------------------------------------

/**
 * Detect whether a university course code is a generic elective.
 * UConn uses patterns like "ELEC 1000", "XXX ELEC", or subjects like "ELEC".
 */
function detectElective(
  intSubject: string,
  intNumber: string,
  intTitle: string,
): boolean {
  const subjectUpper = intSubject.toUpperCase();
  const numberUpper = intNumber.toUpperCase();
  const titleUpper = intTitle.toUpperCase();
  return (
    subjectUpper === "ELEC" ||
    subjectUpper.includes("ELEC") ||
    numberUpper === "ELEC" ||
    titleUpper.includes("ELECTIVE") ||
    intNumber === "0000" ||
    intNumber === "000"
  );
}

/**
 * Detect whether the record represents no transferable credit.
 */
function detectNoCredit(
  intSubject: string,
  intNumber: string,
  intTitle: string,
): boolean {
  const titleUpper = intTitle.toUpperCase();
  const hasNoSubject = !intSubject && !intNumber;
  return (
    hasNoSubject ||
    titleUpper.includes("NO CREDIT") ||
    titleUpper.includes("NOT ACCEPTABLE") ||
    titleUpper.includes("NOT TRANSFERABLE") ||
    titleUpper.includes("REMEDIAL") ||
    titleUpper.includes("NO EQUIVALENT")
  );
}

/**
 * Convert a single UConn API record into one TransferMapping.
 * Per the spec: create one mapping per unique cc_prefix + cc_number.
 * When multiple int_classCodes exist, use the first one for univ_course.
 */
function recordToMapping(record: UConnRecord): TransferMapping {
  const ccPrefix = record.ext_subject ?? "";
  const ccNumber = record.ext_number ?? "";
  const ccCourse = `${ccPrefix} ${ccNumber}`.trim();

  // University-side fields
  const intCodes = record.int_classCodes ?? [];
  const intTitles = record.int_classTitles ?? [];
  const intSubject = record.int_subject ?? "";
  const intNumber = record.int_number ?? "";
  const intTitle =
    record.int_title ?? intTitles[0] ?? "";

  // Build univ_course from the first int_classCodes entry, falling back to
  // int_subject + int_number if the array is empty.
  let univCourse = "";
  if (intCodes.length > 0) {
    univCourse = intCodes[0];
  } else if (intSubject && intNumber) {
    univCourse = `${intSubject} ${intNumber}`;
  }

  const noCredit = detectNoCredit(intSubject, intNumber, intTitle);
  const isElective = !noCredit && detectElective(intSubject, intNumber, intTitle);

  // If there are multiple equivalency codes, note them
  const notes =
    intCodes.length > 1
      ? `Also equivalent to: ${intCodes.slice(1).join(", ")}`
      : "";

  return {
    cc_prefix: ccPrefix,
    cc_number: ccNumber,
    cc_course: ccCourse,
    cc_title: "", // not available from this API
    cc_credits: 0, // not available from this API
    university: UNIVERSITY_SLUG,
    university_name: UNIVERSITY_DISPLAY,
    univ_course: noCredit ? "" : univCourse,
    univ_title: intTitle || (noCredit ? "No UConn credit" : ""),
    univ_credits: 0, // not available from this API
    notes,
    no_credit: noCredit,
    is_elective: isElective,
  };
}

// ---------------------------------------------------------------------------
// Main scrape logic
// ---------------------------------------------------------------------------

export async function scrapeUConn(): Promise<TransferMapping[]> {
  console.log("UConn Transfer Equivalency Scraper");
  console.log(`  Source: ${BASE_URL}`);
  console.log(`  Institution: ${SCHOOL_NAME}`);
  console.log(`  Strategy: /schools → subjects list → per-subject records\n`);

  // Step 1: Verify the school exists in UConn's system
  console.log("Step 1: Fetching school list...");
  const schools = await fetchSchools();
  if (schools.length === 0) {
    throw new Error("Failed to fetch school list from UConn API");
  }
  console.log(`  Found ${schools.length} schools`);

  const matchedSchool = schools.find((s) => s === SCHOOL_NAME);
  if (!matchedSchool) {
    // Try a case-insensitive search and report what we found
    const fuzzy = schools.find((s) =>
      s.toLowerCase().includes("connecticut state"),
    );
    if (fuzzy) {
      console.warn(
        `  WARNING: "${SCHOOL_NAME}" not found exactly; closest match: "${fuzzy}"`,
      );
      console.warn(`  Update SCHOOL_NAME in this script if the name changed.`);
    } else {
      console.error(
        `  ERROR: "${SCHOOL_NAME}" not found in UConn's school list.`,
      );
      console.error(`  Available schools (first 10):`, schools.slice(0, 10));
    }
    throw new Error(`School not found: ${SCHOOL_NAME}`);
  }
  console.log(`  Confirmed school: "${matchedSchool}"\n`);

  // Step 2: Fetch all subjects offered from this school
  console.log("Step 2: Fetching subject list...");
  const subjects = await fetchSubjects(matchedSchool);
  if (subjects.length === 0) {
    throw new Error(`No subjects found for school: ${matchedSchool}`);
  }
  console.log(`  Found ${subjects.length} subjects: ${subjects.join(", ")}\n`);

  // Step 3: Fetch equivalencies for each subject
  console.log("Step 3: Fetching equivalencies per subject...");
  const allMappings: TransferMapping[] = [];
  let totalRecords = 0;

  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i];
    const records = await fetchEquivalencies(subject, matchedSchool);

    if (records.length > 0) {
      console.log(`  ${subject}: ${records.length} records`);
      totalRecords += records.length;

      for (const record of records) {
        // Skip records that don't match our expected school
        if (record.school && record.school !== matchedSchool) continue;
        // Skip records without a CC course number
        if (!record.ext_subject || !record.ext_number) continue;

        allMappings.push(recordToMapping(record));
      }
    } else {
      console.log(`  ${subject}: 0 records`);
    }

    // Rate-limit — be polite to UConn's server
    if (i < subjects.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n  Total API records: ${totalRecords}`);
  console.log(`  Total mappings before dedup: ${allMappings.length}`);

  // Step 4: Deduplicate on cc_prefix + cc_number + univ_course
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // Summary stats
  const directEquiv = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log("\n  Summary:");
  console.log(`    Direct equivalencies: ${directEquiv}`);
  console.log(`    Elective credit: ${electives}`);
  console.log(`    No credit: ${noCreditCount}`);
  console.log(`    Subject prefixes: ${prefixes.size}`);

  // Spot checks
  const eng1010 = deduped.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "1010",
  );
  if (eng1010) {
    console.log(
      `\n  Spot check — ENG 1010: -> ${eng1010.univ_course} (${eng1010.univ_title})`,
    );
  }
  const acct1130 = deduped.find(
    (m) => m.cc_prefix === "ACCT" && m.cc_number === "1130",
  );
  if (acct1130) {
    console.log(
      `  Spot check — ACCT 1130: -> ${acct1130.univ_course} (${acct1130.univ_title})`,
    );
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  const mappings = await scrapeUConn();

  if (mappings.length === 0) {
    console.error("\nNo mappings found! Check if the UConn API changed.");
    process.exit(1);
  }

  // Write to data file (merge with existing, replacing old uconn entries)
  const outDir = path.join(process.cwd(), "data", "ct");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run — file doesn't exist yet */
  }

  // Drop old uconn entries, append freshly scraped ones
  const nonUconn = existing.filter((m) => m.university !== UNIVERSITY_SLUG);
  const merged = [...nonUconn, ...mappings];

  // Sort: by cc_prefix, then cc_number, then university
  merged.sort((a, b) => {
    if (a.cc_prefix !== b.cc_prefix) return a.cc_prefix.localeCompare(b.cc_prefix);
    if (a.cc_number !== b.cc_number) return a.cc_number.localeCompare(b.cc_number);
    return a.university.localeCompare(b.university);
  });

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} UConn mappings to ${outPath}`);
  console.log(`  Total in file (all universities): ${merged.length}`);

  // Supabase import
  if (!noImport) {
    try {
      await importTransfersToSupabase("ct");
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
