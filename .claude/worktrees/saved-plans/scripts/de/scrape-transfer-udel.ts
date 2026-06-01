/**
 * scrape-transfer-udel.ts
 *
 * Scrapes transfer equivalency data from University of Delaware's
 * Transfer Credit Matrix for Delaware Technical Community College (DTCC).
 *
 * Flow:
 *   1. POST /transfercredit/schools  — select USA + Delaware
 *   2. POST /transfercredit/courses  — select DTCC (code 0045342)
 *   3. Parse HTML table → TransferMapping[]
 *   4. Save to data/de/transfer-equiv.json
 *   5. Import to Supabase
 *
 * The entire course list is returned in a single HTML page (~264KB, ~287 rows).
 * No pagination needed.
 *
 * Usage:
 *   npx tsx scripts/de/scrape-transfer-udel.ts
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://udapps.nss.udel.edu/transfercredit";
const DTCC_CODE = "0045342";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Content-Type": "application/x-www-form-urlencoded",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clean HTML text: normalize whitespace, decode entities.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a course code like "ACCT  207" into prefix + number.
 */
function parseCourse(raw: string): { prefix: string; number: string } {
  const cleaned = cleanText(raw);
  const match = cleaned.match(/^([A-Z]{2,5})\s+(\S+.*)$/);
  if (match) return { prefix: match[1], number: match[2].trim() };
  return { prefix: "", number: cleaned };
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

/**
 * Extract Set-Cookie headers and format for reuse.
 */
function extractCookies(resp: Response): string {
  const setCookies = resp.headers.getSetCookie?.() || [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

/**
 * Merge cookies from multiple responses.
 */
function mergeCookies(existing: string, newCookies: string): string {
  if (!newCookies) return existing;
  if (!existing) return newCookies;
  const map = new Map<string, string>();
  for (const pair of existing.split("; ")) {
    const [k, ...rest] = pair.split("=");
    if (k) map.set(k, rest.join("="));
  }
  for (const pair of newCookies.split("; ")) {
    const [k, ...rest] = pair.split("=");
    if (k) map.set(k, rest.join("="));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Navigate to the courses page for DTCC.
 * Must maintain session cookies (JSESSIONID) across requests.
 */
async function fetchCoursesPage(): Promise<string> {
  // Step 0: GET the landing page to establish session
  console.log("Step 0: Establishing session...");
  const initResp = await fetch(`${BASE_URL}/`, {
    headers: { "User-Agent": HEADERS["User-Agent"] },
    redirect: "follow",
  });
  let cookies = extractCookies(initResp);
  await initResp.text();
  console.log(`  Session cookies: ${cookies ? "yes" : "none"}`);

  // Step 1: POST country/state selection
  console.log("Step 1: Selecting USA → Delaware...");
  const schoolsResp = await fetch(`${BASE_URL}/schools`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: cookies },
    body: "countryCode=USA&stateCode=DE",
    redirect: "follow",
  });
  if (!schoolsResp.ok) {
    throw new Error(`Schools page HTTP ${schoolsResp.status}`);
  }
  cookies = mergeCookies(cookies, extractCookies(schoolsResp));
  await schoolsResp.text(); // consume body

  // Step 2: POST institution selection
  console.log("Step 2: Selecting Delaware Technical/CC...");
  const coursesResp = await fetch(`${BASE_URL}/courses`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: cookies },
    body: `institutionCode=${DTCC_CODE}&submitAction=submit`,
    redirect: "follow",
  });
  if (!coursesResp.ok) {
    throw new Error(`Courses page HTTP ${coursesResp.status}`);
  }

  const html = await coursesResp.text();
  console.log(`  Received ${(html.length / 1024).toFixed(0)} KB of HTML`);
  return html;
}

/**
 * Parse the courses HTML table.
 *
 * Table structure per row:
 *   <tr>
 *     <td><div class="add_seven" style="display:none">YEAR</div></td>
 *     <td><div>CC_COURSE</div></td>
 *     <td><div>CC_TITLE</div></td>
 *     <td><div>UD_COURSE</div></td>
 *     <td><div>UD_TITLE</div></td>
 *   </tr>
 *
 * Some rows have multiple divs per cell (combo courses).
 * We skip rows with multiple CC courses (too complex to represent).
 */
function parseCourseTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];
  let skippedCombos = 0;

  $("table.js-dataTable-courses tr").each(
    (_, row) => {
      const tds = $(row).find("td");
      if (tds.length < 5) return;

      // Extract divs from each cell
      const ccDivs = $(tds[1]).find("div").toArray();
      const ccTitleDivs = $(tds[2]).find("div").toArray();
      const udDivs = $(tds[3]).find("div").toArray();
      const udTitleDivs = $(tds[4]).find("div").toArray();

      // Skip combo rows (multiple CC courses)
      if (ccDivs.length > 1) {
        skippedCombos++;
        return;
      }

      if (ccDivs.length === 0 || udDivs.length === 0) return;

      const ccCourseRaw = cleanText($(ccDivs[0]).text());
      const ccTitle = cleanText($(ccTitleDivs[0])?.text() || "");

      if (!ccCourseRaw) return;

      const cc = parseCourse(ccCourseRaw);
      if (!cc.prefix) return;

      // Map to the primary (first) UD equivalency
      const udCourseRaw = cleanText($(udDivs[0]).text());
      const udTitle = cleanText($(udTitleDivs[0])?.text() || "");

      const ud = parseCourse(udCourseRaw);

      // Detect "166T" elective transfer credit (generic transfer credit)
      const is166T = ud.number.includes("166T");

      // Detect department elective: "66DE" pattern
      const isDeptElective = ud.number.includes("66DE");

      // Detect elective patterns
      const isElective =
        isDeptElective ||
        is166T ||
        udTitle.toLowerCase().includes("elective") ||
        udTitle.toLowerCase().includes("general education");

      // Detect no credit (very rare in UDel matrix — they generally
      // show what the course maps to, even if just elective)
      const noCredit =
        udTitle.toLowerCase().includes("no credit") ||
        udTitle.toLowerCase().includes("does not transfer");

      // If there are additional UD courses, note them
      let notes = "";
      if (udDivs.length > 1) {
        const additionalCourses = udDivs
          .slice(1)
          .map((d) => cleanText($(d).text()))
          .join(", ");
        notes = `Also awards: ${additionalCourses}`;
      }

      // Check for breadth eligibility
      const breadthDiv = $(tds[4]).find(".breadth_eligible").length > 0;
      if (breadthDiv) {
        notes = notes
          ? `${notes}; Eligible for breadth`
          : "Eligible for breadth";
      }

      mappings.push({
        state: "de",
        cc_prefix: cc.prefix,
        cc_number: cc.number,
        cc_course: `${cc.prefix} ${cc.number}`,
        cc_title: ccTitle,
        cc_credits: "", // Not shown in UDel matrix
        university: "udel",
        university_name: "University of Delaware",
        univ_course: noCredit ? "" : udCourseRaw,
        univ_title: noCredit ? "No UD credit" : udTitle,
        univ_credits: "", // Not shown in UDel matrix
        notes,
        no_credit: noCredit,
        is_elective: isElective && !noCredit,
      });
    }
  );

  if (skippedCombos > 0) {
    console.log(
      `  Skipped ${skippedCombos} combo rows (multiple CC courses per mapping)`
    );
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("University of Delaware Transfer Credit Scraper\n");
  console.log("Target: Delaware Technical Community College (DTCC)\n");

  const html = await fetchCoursesPage();
  const mappings = parseCourseTable(html);

  if (mappings.length === 0) {
    console.log("⚠ No mappings found! Check if the page structure changed.");
    process.exit(1);
  }

  // Stats
  const directEquiv = mappings.filter(
    (m) => !m.no_credit && !m.is_elective
  ).length;
  const electives = mappings.filter(
    (m) => !m.no_credit && m.is_elective
  ).length;
  const noCredit = mappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(mappings.map((m) => m.cc_prefix));

  console.log(`\nSummary:`);
  console.log(`  Total mappings: ${mappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng101 = mappings.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "101"
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101: → ${eng101.univ_course} (${eng101.univ_title})`
    );
  }
  const acc101 = mappings.find(
    (m) => m.cc_prefix === "ACC" && m.cc_number === "101"
  );
  if (acc101) {
    console.log(
      `  Spot check — ACC 101: → ${acc101.univ_course} (${acc101.univ_title})`
    );
  }
  const mat151 = mappings.find(
    (m) => m.cc_prefix === "MAT" && m.cc_number === "151"
  );
  if (mat151) {
    console.log(
      `  Spot check — MAT 151: → ${mat151.univ_course} (${mat151.univ_title})`
    );
  }

  // Save — merge with existing data (preserve non-udel entries)
  const outPath = path.join(
    process.cwd(),
    "data",
    "de",
    "transfer-equiv.json"
  );
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    if (existing.length > 0) {
      console.log(`\nLoaded ${existing.length} existing mappings`);
    }
  } catch {
    // No existing file
  }

  const nonUdel = existing.filter((m) => m.university !== "udel");
  const merged = [...nonUdel, ...mappings];

  console.log(
    `\nMerged: ${nonUdel.length} existing (non-udel) + ${mappings.length} udel = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  try {
    const imported = await importTransfersToSupabase("de");
    if (imported > 0) {
      console.log(`Imported ${imported} rows to Supabase`);
    }
  } catch (err) {
    console.log(`Supabase import skipped: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
