/**
 * scrape-collegetransfer.ts
 *
 * Shared utility for scraping transfer equivalency data from CollegeTransfer.Net's
 * public OData v2 API (courseatlasservices.azurewebsites.net).
 *
 * This API powers the CollegeTransfer.Net equivalency widgets used by many
 * universities. Returns clean JSON — no HTML parsing needed.
 *
 * Usage:
 *   import { scrapeCollegeTransfer } from "../lib/scrape-collegetransfer.js";
 *   const mappings = await scrapeCollegeTransfer({
 *     senderId: 3396,          // DTCC
 *     receiverId: 511,         // Delaware State University
 *     universitySlug: "desu",
 *     universityName: "Delaware State University",
 *     state: "de",
 *   });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransferMapping {
  state: string;
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

interface ODataCourse {
  Prefix: string;
  Number: string;
  Title: string;
  Credits?: string;
  WildcardRule?: string | null;
  WildcardDescription?: string | null;
  Suffix?: string | null;
  MinimumGrade?: string | null;
}

interface ODataEquivalency {
  EquivalencyId: number;
  SourceInstitutionId: number;
  SourceInstitutionName: string;
  TargetInstitutionId: number;
  TargetInstitutionName: string;
  DoesNotTransfer: boolean;
  Notes: string | null;
  SourceCourses: ODataCourse[];
  TargetCourses: ODataCourse[];
}

interface ODataResponse {
  value: ODataEquivalency[];
  "odata.nextLink"?: string;
}

export interface ScrapeOptions {
  senderId: number;
  receiverId: number;
  universitySlug: string;
  universityName: string;
  state: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL =
  "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY = "bc923312-6f95-4340-8eed-c89bd576521c";
const PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Detect if a target course is an elective based on course number patterns.
 */
function isElectiveCourse(course: ODataCourse): boolean {
  const num = course.Number || "";
  const title = (course.Title || "").toLowerCase();
  return (
    num.includes("XXX") ||
    num.includes("xxx") ||
    title.includes("elective") ||
    title.includes("general education") ||
    course.WildcardRule != null
  );
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

/**
 * Scrape all transfer equivalencies for a sender→receiver pair from
 * CollegeTransfer.Net's OData API.
 */
export async function scrapeCollegeTransfer(
  opts: ScrapeOptions
): Promise<TransferMapping[]> {
  const { senderId, receiverId, universitySlug, universityName, state } =
    opts;

  const mappings: TransferMapping[] = [];
  let skip = 0;
  let total = 0;
  let skippedCombos = 0;

  while (true) {
    const params = new URLSearchParams({
      $format: "json",
      apikey: API_KEY,
      $filter: `SourceInstitutionId eq ${senderId} and TargetInstitutionId eq ${receiverId}`,
      $expand: "SourceCourses,TargetCourses",
      $top: String(PAGE_SIZE),
      $skip: String(skip),
    });

    const url = `${BASE_URL}/Equivalencies?${params}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`OData API HTTP ${resp.status}: ${resp.statusText}`);
    }

    const data: ODataResponse = await resp.json();
    const batch = data.value;

    if (batch.length === 0) break;
    total += batch.length;

    for (const eq of batch) {
      const sources = eq.SourceCourses || [];
      const targets = eq.TargetCourses || [];

      // Skip combo courses (multiple source courses required together)
      if (sources.length > 1) {
        skippedCombos++;
        continue;
      }

      if (sources.length === 0 || targets.length === 0) continue;

      const src = sources[0];
      const ccPrefix = src.Prefix?.trim() || "";
      const ccNumber = src.Number?.trim() || "";
      const ccTitle = src.Title?.trim() || "";

      if (!ccPrefix || !ccNumber) continue;

      // Take primary (first) target course
      const tgt = targets[0];
      const univCourse = `${tgt.Prefix} ${tgt.Number}`.trim();
      const univTitle = tgt.Title?.trim() || "";
      const univCredits = tgt.Credits?.trim() || "";

      const noCredit = eq.DoesNotTransfer === true;
      const isElective = !noCredit && isElectiveCourse(tgt);

      // Note additional target courses if any
      let notes = eq.Notes?.trim() || "";
      if (targets.length > 1) {
        const additional = targets
          .slice(1)
          .map((t) => `${t.Prefix} ${t.Number}`)
          .join(", ");
        notes = notes
          ? `${notes}; Also awards: ${additional}`
          : `Also awards: ${additional}`;
      }

      mappings.push({
        state,
        cc_prefix: ccPrefix,
        cc_number: ccNumber,
        cc_course: `${ccPrefix} ${ccNumber}`,
        cc_title: ccTitle,
        cc_credits: "", // Not reliably provided in source
        university: universitySlug,
        university_name: universityName,
        univ_course: noCredit ? "" : univCourse,
        univ_title: noCredit ? "Does not transfer" : univTitle,
        univ_credits: noCredit ? "" : univCredits,
        notes,
        no_credit: noCredit,
        is_elective: isElective,
      });
    }

    // Check if there are more pages
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await sleep(200); // Rate limiting
  }

  if (skippedCombos > 0) {
    console.log(
      `  Skipped ${skippedCombos} combo equivalencies (multiple source courses)`
    );
  }

  console.log(
    `  ${total} raw → ${mappings.length} mappings (${mappings.filter((m) => !m.no_credit).length} transferable)`
  );

  return mappings;
}
