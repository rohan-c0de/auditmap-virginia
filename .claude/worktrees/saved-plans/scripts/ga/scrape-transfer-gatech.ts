/**
 * scrape-transfer-gatech.ts
 *
 * Scrapes transfer equivalency data from Georgia Tech's Banner wwsktrna
 * Transfer Articulation tool for all TCSG (Technical College System of
 * Georgia) colleges.
 *
 * Flow:
 *   1. GET  P_find_location          → establish cookies
 *   2. POST P_find_state             → navigate to state selector
 *   3. For each TCSG college:
 *      a. POST P_find_subj_levl      → get available subjects
 *      b. POST P_find_subj_levl_classes → get all equivalencies (all subjects, all terms)
 *   4. Parse HTML table → TransferMapping[]
 *   5. Deduplicate, prefer current ("The End of Time") entries
 *   6. Save to data/ga/transfer-equiv.json
 *   7. Import to Supabase
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-transfer-gatech.ts
 *   npx tsx scripts/ga/scrape-transfer-gatech.ts --college atlanta-tech
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
// TCSG colleges → Banner FICE codes
// ---------------------------------------------------------------------------

const TCSG_COLLEGES: Record<string, { fice: string; name: string }> = {
  "albany-tech":            { fice: "003921", name: "Albany Technical College" },
  "athens-tech":            { fice: "000462", name: "Athens Technical College" },
  "atlanta-tech":           { fice: "005030", name: "Atlanta Technical College" },
  "augusta-tech":           { fice: "002620", name: "Augusta Technical College" },
  "central-ga-tech":        { fice: "001709", name: "Central Georgia Tech College" },
  "chattahoochee-tech":     { fice: "005441", name: "Chattahoochee Tech College" },
  "coastal-pines-tech":     { fice: "004172", name: "Coastal Pines Technical College" },
  "columbus-tech":          { fice: "005704", name: "Columbus Technical College" },
  "ga-northwestern-tech":   { fice: "002860", name: "Georgia Northwestern Tech College" },
  "ga-piedmont-tech":       { fice: "003226", name: "Georgia Piedmont Technical College" },
  "gwinnett-tech":          { fice: "005168", name: "Gwinnett Technical College" },
  "lanier-tech":            { fice: "007289", name: "Lanier Technical College" },
  "middle-ga-tech":         { fice: "005035", name: "Middle Georgia Tech College" },
  "north-ga-tech":          { fice: "005507", name: "North Georgia Tech College" },
  "oconee-fall-line-tech":  { fice: "005772", name: "Oconee Fall Line Tech College" },
  "ogeechee-tech":          { fice: "000154", name: "Ogeechee Technical College" },
  "savannah-tech":          { fice: "003741", name: "Savannah Tech College" },
  "southeastern-tech":      { fice: "005652", name: "Southeastern Technical College" },
  "southern-crescent-tech": { fice: "005670", name: "Southern Crescent Tech College" },
  "southern-regional-tech": { fice: "007196", name: "Southern Regional Tech College" },
  "west-ga-tech":           { fice: "006342", name: "West Georgia Technical College" },
  "wiregrass-tech":         { fice: "004557", name: "Wiregrass Georgia Tech College" },
};

const BASE_URL = "https://oscar.gatech.edu/pls/bprod";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Content-Type": "application/x-www-form-urlencoded",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extract Set-Cookie headers from a response and format for reuse.
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
    const [k, v] = pair.split("=");
    if (k) map.set(k, v || "");
  }
  for (const pair of newCookies.split("; ")) {
    const [k, v] = pair.split("=");
    if (k) map.set(k, v || "");
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Clean Banner HTML text: strip tags, normalize &nbsp; to spaces, trim.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a course code string like "ENGL  1101" into prefix + number.
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
 * Establish a session by navigating the Banner landing pages.
 * Returns the session cookies.
 */
async function initSession(): Promise<string> {
  // Step 1: GET the location page
  const loc = await fetch(`${BASE_URL}/wwsktrna.P_find_location`, {
    headers: HEADERS,
    redirect: "follow",
  });
  let cookies = extractCookies(loc);
  await loc.text(); // consume body

  // Step 2: POST "Yes" to navigate to state selector
  const state = await fetch(`${BASE_URL}/wwsktrna.P_find_state`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: cookies },
    redirect: "follow",
  });
  cookies = mergeCookies(cookies, extractCookies(state));
  await state.text(); // consume body

  return cookies;
}

/**
 * Fetch the available subjects for a college.
 */
async function getSubjects(
  fice: string,
  cookies: string
): Promise<string[]> {
  const resp = await fetch(`${BASE_URL}/wwsktrna.P_find_subj_levl`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: cookies },
    body: `state_in=GA&nation_in=&sbgi_in=${fice}&term_in=`,
    redirect: "follow",
  });

  const html = await resp.text();
  const $ = cheerio.load(html);
  const subjects: string[] = [];

  $('select[name="sel_subj"] option').each((_, el) => {
    const val = $(el).attr("value");
    if (val) subjects.push(val);
  });

  return subjects;
}

/**
 * Fetch all course equivalencies for a college + list of subjects.
 */
async function fetchEquivalencies(
  fice: string,
  subjects: string[],
  cookies: string
): Promise<string> {
  const params = new URLSearchParams();
  params.append("state_in", "GA");
  params.append("nation_in", "");
  for (const subj of subjects) {
    params.append("sel_subj", subj);
  }
  params.append("levl_in", "US");
  params.append("term_in", "999999"); // All terms
  params.append("sbgi_in", fice);
  params.append("school_in", "");

  const resp = await fetch(
    `${BASE_URL}/wwsktrna.P_find_subj_levl_classes`,
    {
      method: "POST",
      headers: { ...HEADERS, Cookie: cookies },
      body: params.toString(),
      redirect: "follow",
    }
  );

  return resp.text();
}

/**
 * Parse the equivalencies result table.
 *
 * Table columns (td.dddefault):
 *   0: CC course     (e.g., "ENGL  1101")
 *   1: CC title      (e.g., "Composition and Rhetoric")
 *   2: Level         (e.g., "Undergraduate")
 *   3: (empty)
 *   4: Grade         (e.g., "C")
 *   5: Term range    (e.g., "Fall 2011 - The End of Time")
 *   6: Arrow "=>"
 *   7: (empty)
 *   8: GT course     (e.g., "ENGL  1101")
 *   9: GT title      (e.g., "English Composition I")
 *  10: GT credits    (e.g., "3.0")
 *  11: (empty)
 */
function parseEquivalencyTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("table tr").each((_, row) => {
    const tds = $(row).find("td.dddefault");
    if (tds.length < 10) return; // Not a data row

    const ccCourseRaw = cleanText($(tds[0]).text());
    const ccTitle = cleanText($(tds[1]).text());
    const termRange = cleanText($(tds[5]).text());
    const gtCourseRaw = cleanText($(tds[8]).text());
    const gtTitle = cleanText($(tds[9]).text());
    const gtCredits = cleanText($(tds[10]).text());

    if (!ccCourseRaw) return;

    const cc = parseCourse(ccCourseRaw);
    if (!cc.prefix) return;

    const gt = parseCourse(gtCourseRaw);

    // Detect no credit: "ET NOGT", "No Georgia Tech Credit", "No GT Credit"
    const noCredit =
      gtCourseRaw.includes("ET NOGT") ||
      gtCourseRaw === "ET NOGT" ||
      gtTitle.toLowerCase().includes("no georgia tech credit") ||
      gtTitle.toLowerCase().includes("no gt credit") ||
      (gtCredits === "0.0" && !gtTitle.toLowerCase().includes("elective"));

    // Detect needs evaluation: "ET DEPT"
    const needsEval =
      gtCourseRaw === "ET DEPT" ||
      gtTitle.toLowerCase().includes("must evaluate");

    // Detect elective: "XXX" in course number, "FREE", "Elective" in title
    const isElective =
      !noCredit &&
      !needsEval &&
      (gt.number.includes("XXX") ||
        gt.prefix === "FREE" ||
        gtTitle.toLowerCase().includes("elective"));

    // Determine if this is a current mapping
    const isCurrent = termRange.includes("The End of Time");

    mappings.push({
      state: "ga",
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: ccTitle,
      cc_credits: "", // Not provided in Banner table
      university: "gatech",
      university_name: "Georgia Tech",
      univ_course: noCredit || needsEval ? "" : gtCourseRaw,
      univ_title: noCredit
        ? "No Georgia Tech credit"
        : needsEval
          ? "Department must evaluate"
          : gtTitle,
      univ_credits: noCredit || needsEval ? "" : gtCredits,
      notes: isCurrent ? "" : `Valid: ${termRange}`,
      no_credit: noCredit || needsEval,
      is_elective: isElective,
    });
  });

  return mappings;
}

/**
 * Deduplicate mappings: if a CC course has both a current and a historical
 * mapping, keep only the current one.
 */
function deduplicateMappings(
  mappings: TransferMapping[]
): TransferMapping[] {
  // Group by cc_course
  const groups = new Map<string, TransferMapping[]>();
  for (const m of mappings) {
    const key = m.cc_course;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  const result: TransferMapping[] = [];
  for (const [, group] of groups) {
    // If there's a current mapping (no notes = current), prefer it
    const current = group.filter((m) => !m.notes);
    if (current.length > 0) {
      result.push(...current);
    } else {
      // Keep the most recent historical mapping
      result.push(group[0]);
    }
  }

  return result;
}

/**
 * Scrape all equivalencies for one college.
 */
async function scrapeCollege(
  slug: string,
  college: { fice: string; name: string },
  cookies: string
): Promise<TransferMapping[]> {
  // Step 1: Get available subjects
  const subjects = await getSubjects(college.fice, cookies);
  if (subjects.length === 0) {
    console.log(`  No subjects found`);
    return [];
  }
  console.log(`  ${subjects.length} subjects: ${subjects.join(", ")}`);

  await sleep(300);

  // Step 2: Fetch all equivalencies
  const html = await fetchEquivalencies(college.fice, subjects, cookies);
  const rawMappings = parseEquivalencyTable(html);

  // Step 3: Deduplicate
  const mappings = deduplicateMappings(rawMappings);

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Georgia Tech Transfer Equivalency Scraper\n");

  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const targetSlug = collegeIdx >= 0 ? args[collegeIdx + 1] : null;

  if (targetSlug && !TCSG_COLLEGES[targetSlug]) {
    console.error(`Unknown college: ${targetSlug}`);
    console.error(`Available: ${Object.keys(TCSG_COLLEGES).join(", ")}`);
    process.exit(1);
  }

  const targets = targetSlug
    ? [[targetSlug, TCSG_COLLEGES[targetSlug]] as const]
    : (Object.entries(TCSG_COLLEGES) as [
        string,
        { fice: string; name: string },
      ][]);

  console.log(
    `Scraping ${targets.length} TCSG college(s) → Georgia Tech equivalencies\n`
  );

  // Initialize session
  console.log("Initializing Banner session...");
  const cookies = await initSession();
  console.log("Session established\n");

  const allMappings: TransferMapping[] = [];
  let totalRaw = 0;

  for (const [slug, college] of targets) {
    console.log(`${slug} (${college.name}, FICE ${college.fice}):`);
    try {
      const mappings = await scrapeCollege(slug, college, cookies);
      const transferable = mappings.filter((m) => !m.no_credit);
      console.log(
        `  ${mappings.length} equivalencies (${transferable.length} transferable)\n`
      );
      totalRaw += mappings.length;
      allMappings.push(...mappings);
    } catch (err) {
      console.error(`  Error: ${(err as Error).message}\n`);
    }
    await sleep(500); // Rate limiting between colleges
  }

  // Filter out no-credit entries (they add noise)
  const transferableRaw = allMappings.filter((m) => !m.no_credit);

  // Deduplicate across colleges: same cc_course + univ_course = same mapping
  const seen = new Set<string>();
  const transferable: TransferMapping[] = [];
  for (const m of transferableRaw) {
    const key = `${m.cc_course}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transferable.push(m);
  }
  console.log(
    `\nDeduplicated: ${transferableRaw.length} → ${transferable.length} unique equivalencies`
  );

  // Stats
  const directEquiv = transferable.filter((m) => !m.is_elective).length;
  const electives = transferable.filter((m) => m.is_elective).length;
  const noCredit = allMappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(transferable.map((m) => m.cc_prefix));
  const colleges = new Set(
    allMappings.map((m) => m.cc_course).length
      ? targets.map(([s]) => s)
      : []
  );

  console.log(`\nSummary:`);
  console.log(`  Colleges scraped: ${targets.length}`);
  console.log(`  Total raw mappings: ${totalRaw}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit / needs eval: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const engl1101 = transferable.find(
    (m) => m.cc_prefix === "ENGL" && m.cc_number === "1101"
  );
  if (engl1101) {
    console.log(
      `\n  Spot check — ENGL 1101: → ${engl1101.univ_course} (${engl1101.univ_title})`
    );
  }
  const math1111 = transferable.find(
    (m) => m.cc_prefix === "MATH" && m.cc_number === "1111"
  );
  if (math1111) {
    console.log(
      `  Spot check — MATH 1111: → ${math1111.univ_course} (${math1111.univ_title})`
    );
  }

  if (transferable.length === 0) {
    console.log("\n⚠ No transferable mappings found! Check if the site changed.");
    process.exit(1);
  }

  // Save — merge with existing data (preserve non-gatech entries)
  const outPath = path.join(process.cwd(), "data", "ga", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    if (existing.length > 0) {
      console.log(`\nLoaded ${existing.length} existing mappings`);
    }
  } catch {
    // No existing file or empty
  }

  const nonGatech = existing.filter((m) => m.university !== "gatech");
  const merged = [...nonGatech, ...transferable];

  console.log(
    `\nMerged: ${nonGatech.length} existing (non-gatech) + ${transferable.length} gatech = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  try {
    const imported = await importTransfersToSupabase("ga");
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
