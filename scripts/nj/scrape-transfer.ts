/**
 * scrape-transfer.ts
 *
 * Scrapes transfer equivalency data from NJTransfer.org for all 19 NJ
 * community college campuses → major NJ universities.
 *
 * NJTransfer.org is a state-mandated CGI application that stores
 * articulation agreements between NJ community colleges and four-year
 * institutions. The data is publicly accessible via a series of CGI
 * endpoints:
 *
 *   1. chgri.cgi       — institution selector (get session + institution codes)
 *   2. precs.cgi       — set sending/receiving institution pair (creates session)
 *   3. crs-srch.cgi    — course-by-course equivalency lookup
 *   4. crs-srch.cgi?N~ — iterate to next course in sequence
 *   5. crs-srch.cgi?P~ — iterate to previous course in sequence
 *
 * Strategy:
 *   For each CC, set up a session with RI=All (all receiving institutions),
 *   then iterate through ALL courses using the Next navigation link. Each
 *   page shows one CC course and its equivalencies at every university that
 *   has evaluated it. Parse the HTML tables to extract transfer mappings.
 *
 *   We focus on the 8 major public NJ universities: Rutgers (SAS), NJIT,
 *   Montclair State, Rowan, TCNJ, Kean, Stockton, and William Paterson.
 *   Private university data is also captured when present.
 *
 * Usage:
 *   npx tsx scripts/nj/scrape-transfer.ts
 *   npx tsx scripts/nj/scrape-transfer.ts --no-import      # skip Supabase
 *   npx tsx scripts/nj/scrape-transfer.ts --cc=bergen       # single CC test
 *   npx tsx scripts/nj/scrape-transfer.ts --limit=50        # limit courses per CC
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
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
// NJTransfer.org institution codes
// ---------------------------------------------------------------------------

// Extracted from the hidden si_string field on chgri.cgi
// Format: CODE=Name (! separator in original)
const NJ_COMMUNITY_COLLEGES: Record<string, string> = {
  AT: "Atlantic-Cape Community College",
  BE: "Bergen Community College",
  BR: "Brookdale Community College",
  CA: "Camden County College",
  MR: "County College of Morris",
  EX: "Essex County College",
  HD: "Hudson County Community College",
  ME: "Mercer County Community College",
  MI: "Middlesex College",
  OC: "Ocean County College",
  PA: "Passaic County Community College",
  RV: "Raritan Valley Community College",
  BU: "Rowan College at Burlington County",
  CU: "Rowan College of South Jersey - Cumberland Campus",
  GL: "Rowan College of South Jersey - Gloucester Campus",
  SA: "Salem Community College",
  SX: "Sussex County Community College",
  UI: "UCNJ Union College",
  WA: "Warren County Community College",
};

// NJTransfer code → our institution slug mapping
const CC_CODE_TO_SLUG: Record<string, string> = {
  AT: "atlantic-cape",
  BE: "bergen",
  BR: "brookdale",
  CA: "camden",
  MR: "ccm",
  EX: "essex",
  HD: "hccc",
  ME: "mercer",
  MI: "middlesex",
  OC: "ocean",
  PA: "passaic",
  RV: "rvcc",
  BU: "rcbc",
  CU: "rcsj-cumberland",
  GL: "rcsj-gloucester",
  SA: "salem",
  SX: "sussex",
  UI: "ucnj",
  WA: "warren",
};

// Receiving institution codes from ri_string on chgri.cgi
// We track the major public NJ universities plus key privates
const NJ_UNIVERSITIES: Record<string, string> = {
  // Major public universities (primary targets)
  AS: "Rutgers-School of Arts and Sciences",
  EN: "Rutgers-School of Engineering",
  BB: "Rutgers Business School - New Brunswick",
  CM: "Rutgers-Camden - CCAS and Nursing",
  NK: "Rutgers-Newark College of Arts and Sciences",
  NI: "New Jersey Institute of Technology",
  MO: "Montclair State University",
  RO: "Rowan University",
  CJ: "The College of New Jersey",
  KE: "Kean University",
  RS: "Stockton University",
  WP: "William Paterson University",
  // Additional public/quasi-public
  NU: "New Jersey City University",
  RM: "Ramapo College",
  TE: "Thomas Edison State University",
  // Key private universities
  SH: "Seton Hall University",
  RI: "Rider University",
  MU: "Monmouth University",
};

// NJTransfer RI code → our university slug
const UNIV_CODE_TO_SLUG: Record<string, string> = {
  AS: "rutgers-sas",
  EN: "rutgers-eng",
  BB: "rutgers-bus",
  CM: "rutgers-camden",
  NK: "rutgers-newark",
  NI: "njit",
  MO: "montclair",
  RO: "rowan",
  CJ: "tcnj",
  KE: "kean",
  RS: "stockton",
  WP: "william-paterson",
  NU: "njcu",
  RM: "ramapo",
  TE: "tesu",
  SH: "seton-hall",
  RI: "rider",
  MU: "monmouth",
  // Private universities that appear in "All" results
  BK: "berkeley",
  BL: "bloomfield",
  CL: "caldwell",
  CE: "centenary",
  DV: "devry",
  DR: "drew",
  FM: "fdu-florham",
  FD: "fdu-metro",
  FC: "felician",
  GC: "georgian-court",
  SP: "saint-peters",
  SE: "saint-elizabeth",
  // Additional Rutgers schools
  CB: "rutgers-camden-bus",
  BP: "rutgers-bloustein",
  PH: "rutgers-pharmacy",
  MG: "rutgers-mason-gross",
  NB: "rutgers-newark-bus",
  NC: "rutgers-newark-cj",
  NP: "rutgers-newark-spaa",
  UN: "rutgers-newark-uc",
  ML: "rutgers-smlr",
  NR: "rutgers-nursing",
  CK: "rutgers-sebs",
};

// Reverse lookup: university name → slug (for parsing "All" responses)
const UNIV_NAME_TO_SLUG: Record<string, string> = {};
for (const [code, name] of Object.entries(NJ_UNIVERSITIES)) {
  UNIV_NAME_TO_SLUG[name] = UNIV_CODE_TO_SLUG[code] || code.toLowerCase();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://njtransfer.org/artweb";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Delay between requests to avoid stressing the server
const DELAY_MS = 800;
// Max courses per CC (safety limit to prevent infinite loops)
const MAX_COURSES_PER_CC = 2000;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  opts: RequestInit = {},
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(opts.headers || {}),
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return ""; // 4xx — skip
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Get a fresh ArtId (session token) from chgri.cgi.
 */
async function getSessionToken(): Promise<string> {
  const html = await retryFetch(`${BASE_URL}/chgri.cgi`, "get-session");
  const match = html.match(/value="(\d{10,})"/);
  if (!match) {
    throw new Error("Could not extract ArtId from chgri.cgi");
  }
  return match[1];
}

/**
 * Set up a session for a specific CC → All Institutions pair.
 * Returns the new session ID embedded in the response URLs.
 */
async function setupSession(
  ccCode: string,
  artId: string,
): Promise<string> {
  const ccName = NJ_COMMUNITY_COLLEGES[ccCode] || ccCode;
  const body = new URLSearchParams({
    DOC: "",
    SI: ccCode,
    RI: "All",
    SIInst: ccName,
    RIInst: "All Institutions",
    WhereAmI: "NH",
    FromWhere: "precs.cgi",
    ArtId: artId,
  }).toString();

  const html = await retryFetch(
    `${BASE_URL}/precs.cgi`,
    `setup-session(${ccCode})`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  // Extract the new session ID from response URLs
  const sessionMatch = html.match(/crs-srch\.cgi\?(\d+)/);
  if (!sessionMatch) {
    throw new Error(
      `Could not extract session from precs.cgi response for ${ccCode}`,
    );
  }

  return sessionMatch[1];
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single course equivalency page from crs-srch.cgi.
 *
 * The page contains:
 *   1. A "Transfer from" table with the CC course details
 *   2. Zero or more "Transfer to" tables, one per receiving university
 *
 * Transfer-from table structure:
 *   - Course ID: e.g., "ENG101"
 *   - Title: e.g., "ENGLISH COMPOSITION I"
 *   - Minimum Credits / Maximum Credits
 *   - GenEd Area(s)
 *   - Course Status: Active/Inactive
 *
 * Transfer-to table structure:
 *   - University name in header
 *   - Equivalency: course code + title
 *   - Minimum Grade
 *   - Credits
 *   - Transferable: Y/N
 *   - GenEd Area(s) at receiving institution
 *   - Optional footnotes
 */
function parseCourseEquivalencyPage(
  html: string,
  ccCode: string,
): {
  ccCourseId: string;
  ccTitle: string;
  ccCredits: string;
  mappings: TransferMapping[];
  nextUrl: string | null;
} {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // --- Extract CC course info from the "Transfer from" table ---
  let ccCourseId = "";
  let ccTitle = "";
  let ccCredits = "";

  // Find the sending institution card
  const cards = $("div.card");
  cards.each((_, card) => {
    const cardHtml = $(card).html() || "";

    if (cardHtml.includes("Transfer from")) {
      // Extract course ID
      const courseIdMatch = cardHtml.match(
        /<strong>Course ID:\s*<\/strong>\s*([A-Z]{2,6}\d{2,4}[A-Z]?)/i,
      );
      if (courseIdMatch) {
        ccCourseId = courseIdMatch[1].trim();
      }

      // Extract title
      const titleMatch = cardHtml.match(
        /<strong>Title:\s*<\/strong>\s*([^<]+)/i,
      );
      if (titleMatch) {
        ccTitle = titleMatch[1].trim();
      }

      // Extract credits
      const creditsMatch = cardHtml.match(
        /<strong>Minimum Credits:\s*<\/strong>\s*([\d.]+)/i,
      );
      if (creditsMatch) {
        ccCredits = creditsMatch[1].trim();
      }
    }

    if (cardHtml.includes("Transfer to")) {
      // --- Parse receiving institution equivalency ---
      const univNameMatch = cardHtml.match(
        /Transfer to\s*<strong>([^<]+)<\/strong>/i,
      );
      if (!univNameMatch) return;

      const univName = univNameMatch[1].trim();

      // Look up the university slug
      let univSlug = UNIV_NAME_TO_SLUG[univName] || "";
      if (!univSlug) {
        // Try partial matching for university name variations
        for (const [name, slug] of Object.entries(UNIV_NAME_TO_SLUG)) {
          if (
            univName.includes(name) ||
            name.includes(univName) ||
            univName.toLowerCase() === name.toLowerCase()
          ) {
            univSlug = slug;
            break;
          }
        }
      }
      if (!univSlug) {
        // Generate slug from name
        univSlug = univName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      }

      // Extract equivalency course code and title
      const equivMatch = cardHtml.match(
        /<strong>Equivalency:\s*<\/strong>\s*([^<]+?)(?:\s*"[^"]*")?\s*(?:\(([^)]+)\))?/i,
      );
      let univCourse = "";
      let univTitle = "";
      if (equivMatch) {
        univCourse = equivMatch[1].trim();
        univTitle = equivMatch[2]?.trim() || "";
      }

      // Clean up footnote markers from course code
      univCourse = univCourse.replace(/\s*"[^"]*"\s*/g, "").trim();

      // Extract credits
      let univCredits = "";
      const univCreditsMatch = cardHtml.match(
        /<strong>Minimum Credits:\s*<\/strong>\s*([\d.]+)/i,
      );
      if (univCreditsMatch) {
        univCredits = univCreditsMatch[1].trim();
      }

      // Check transferability
      const transferableMatch = cardHtml.match(
        /<strong>Transferable<\/strong>:\s*([YN])/i,
      );
      const isTransferable = transferableMatch
        ? transferableMatch[1] === "Y"
        : true;

      // Extract minimum grade
      let minGrade = "";
      const gradeMatch = cardHtml.match(
        /<strong>Minimum Grade:\s*<\/strong>\s*([A-Z][+-]?)/i,
      );
      if (gradeMatch) {
        minGrade = gradeMatch[1].trim();
      }

      // Extract gen ed areas
      const genEdMatch = cardHtml.match(
        /<strong>GenEd Area\(s\):\s*<\/strong>\s*([^<]*(?:<a[^>]*>[^<]*<\/a>[^<]*)*)/i,
      );
      let genEd = "";
      if (genEdMatch) {
        // Strip HTML tags from gen ed text
        genEd = genEdMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Extract footnotes
      const footnotes: string[] = [];
      const footNoteRegex =
        /<strong>Foot Note:<\/strong>\s*(?:<em>[^<]*<\/em>)?&#160;\s*([^<]+)/gi;
      let fnMatch;
      while ((fnMatch = footNoteRegex.exec(cardHtml)) !== null) {
        footnotes.push(fnMatch[1].trim());
      }

      // Build notes
      const notesParts: string[] = [];
      if (minGrade && minGrade !== "C") {
        notesParts.push(`Min grade: ${minGrade}`);
      }
      if (genEd) {
        notesParts.push(`GenEd: ${genEd}`);
      }
      if (footnotes.length > 0) {
        notesParts.push(footnotes.join("; "));
      }
      const notes = notesParts.join("; ");

      // Detect no-credit and elective
      const noCredit = !isTransferable;
      const isElective =
        !noCredit &&
        (univCourse.includes("XXX") ||
          univCourse.includes("xxx") ||
          univCourse.toLowerCase().includes("elec") ||
          univTitle.toLowerCase().includes("elective") ||
          univTitle.toLowerCase().includes("free elect"));

      // Parse CC course ID into prefix + number
      const ccMatch = ccCourseId.match(/^([A-Z]{2,6})(\d{2,4}[A-Z]?)$/);
      const ccPrefix = ccMatch ? ccMatch[1] : "";
      const ccNumber = ccMatch ? ccMatch[2] : ccCourseId;

      if (ccPrefix && univCourse) {
        mappings.push({
          state: "nj",
          cc_prefix: ccPrefix,
          cc_number: ccNumber,
          cc_course: `${ccPrefix} ${ccNumber}`,
          cc_title: ccTitle,
          cc_credits: ccCredits,
          university: univSlug,
          university_name: univName,
          univ_course: noCredit ? "" : univCourse,
          univ_title: noCredit ? "Does not transfer" : univTitle,
          univ_credits: noCredit ? "" : univCredits,
          notes,
          no_credit: noCredit,
          is_elective: isElective,
        });
      }
    }
  });

  // --- Extract Next course URL ---
  let nextUrl: string | null = null;
  const nextMatch = html.match(/crs-srch\.cgi\?N~(\d+)~(\d+)/);
  if (nextMatch) {
    nextUrl = `${BASE_URL}/crs-srch.cgi?N~${nextMatch[1]}~${nextMatch[2]}`;
  }

  return { ccCourseId, ccTitle, ccCredits, mappings, nextUrl };
}

// ---------------------------------------------------------------------------
// Per-CC scraper
// ---------------------------------------------------------------------------

/**
 * Scrape all transfer equivalencies for a single community college.
 *
 * Flow:
 *   1. Get a fresh session token from chgri.cgi
 *   2. POST to precs.cgi to set CC → All Institutions
 *   3. Search for the first course (starting with "A")
 *   4. Iterate through all courses using the Next link
 *   5. Parse each page and collect TransferMapping entries
 */
async function scrapeCC(
  ccCode: string,
  courseLimit: number,
): Promise<TransferMapping[]> {
  const ccName = NJ_COMMUNITY_COLLEGES[ccCode] || ccCode;
  console.log(`\n  ${ccName} (${ccCode})...`);

  // Step 1: Fresh session
  const artId = await getSessionToken();
  await sleep(300);

  // Step 2: Set up CC → All Institutions
  const sessionId = await setupSession(ccCode, artId);
  await sleep(300);

  // Step 3: Start from the first course
  const firstCourseHtml = await retryFetch(
    `${BASE_URL}/crs-srch.cgi?${sessionId}`,
    `first-course(${ccCode})`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `CRSID=A&LUp=Go&SI=${ccCode}&RI=All&From_where=precs.cgi`,
    },
  );

  if (!firstCourseHtml) {
    console.log("    Empty response for first course, skipping");
    return [];
  }

  const allMappings: TransferMapping[] = [];
  let courseCount = 0;
  const seenCourses = new Set<string>();

  // Parse first course
  let result = parseCourseEquivalencyPage(firstCourseHtml, ccCode);
  if (result.ccCourseId) {
    seenCourses.add(result.ccCourseId);
    allMappings.push(...result.mappings);
    courseCount++;
  }

  // Step 4: Follow Next links
  while (result.nextUrl && courseCount < courseLimit) {
    await sleep(DELAY_MS);

    const html = await retryFetch(
      result.nextUrl,
      `next-course(${ccCode}, #${courseCount})`,
    );

    if (!html) break;

    result = parseCourseEquivalencyPage(html, ccCode);

    // Detect loop (we've come back to a course we've seen)
    if (result.ccCourseId && seenCourses.has(result.ccCourseId)) {
      console.log(
        `    Reached end of course list after ${courseCount} courses (loop detected at ${result.ccCourseId})`,
      );
      break;
    }

    if (result.ccCourseId) {
      seenCourses.add(result.ccCourseId);
      allMappings.push(...result.mappings);
      courseCount++;

      if (courseCount % 50 === 0) {
        console.log(
          `    ${courseCount} courses processed (${allMappings.length} mappings so far)...`,
        );
      }
    } else {
      // Empty page — likely hit the end
      break;
    }
  }

  console.log(
    `    ${courseCount} courses → ${allMappings.length} equivalency mappings`,
  );
  return allMappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const ccArg = args.find((a) => a.startsWith("--cc="))?.split("=")[1];
  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const courseLimit = limitArg ? parseInt(limitArg, 10) : MAX_COURSES_PER_CC;

  console.log("NJTransfer.org — Transfer Equivalency Scraper");
  console.log(`  Source: ${BASE_URL}/chgri.cgi`);
  console.log(`  Target: All receiving institutions\n`);

  // Determine which CCs to scrape
  let ccCodes: string[];
  if (ccArg) {
    // Find the CC code by slug or code
    const codeBySlug = Object.entries(CC_CODE_TO_SLUG).find(
      ([, slug]) => slug === ccArg,
    );
    const code = codeBySlug
      ? codeBySlug[0]
      : ccArg.toUpperCase() in NJ_COMMUNITY_COLLEGES
        ? ccArg.toUpperCase()
        : null;
    if (!code) {
      console.error(`Unknown CC: ${ccArg}`);
      console.error(
        `Available: ${Object.entries(CC_CODE_TO_SLUG)
          .map(([k, v]) => `${v} (${k})`)
          .join(", ")}`,
      );
      process.exit(1);
    }
    ccCodes = [code];
    console.log(
      `Scraping single CC: ${NJ_COMMUNITY_COLLEGES[code]} (${code})`,
    );
  } else {
    ccCodes = Object.keys(NJ_COMMUNITY_COLLEGES);
    console.log(`Scraping all ${ccCodes.length} community colleges`);
  }

  if (courseLimit < MAX_COURSES_PER_CC) {
    console.log(`  Course limit per CC: ${courseLimit}`);
  }

  // Scrape each CC
  const allMappings: TransferMapping[] = [];
  for (const ccCode of ccCodes) {
    try {
      const mappings = await scrapeCC(ccCode, courseLimit);
      allMappings.push(...mappings);
    } catch (err) {
      console.error(
        `  ERROR scraping ${NJ_COMMUNITY_COLLEGES[ccCode]}: ${(err as Error).message}`,
      );
    }

    // Longer pause between colleges
    if (ccCodes.length > 1) {
      await sleep(2000);
    }
  }

  // --- Deduplicate ---
  // Key by (cc_course, university, univ_course) — keep first occurrence
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  console.log(`\n  Total raw mappings: ${allMappings.length}`);
  console.log(`  After dedup: ${deduped.length}`);

  // Filter for stats
  const transferable = deduped.filter((m) => !m.no_credit);
  const directEquiv = transferable.filter((m) => !m.is_elective).length;
  const electives = transferable.filter((m) => m.is_elective).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  // By university
  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university, (byUniv.get(m.university) || 0) + 1);
  }

  console.log("\nSummary:");
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject prefixes: ${prefixes.size}`);
  console.log(`  Universities represented: ${byUniv.size}`);
  for (const [univ, count] of [...byUniv.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${univ}: ${count}`);
  }

  // Spot checks
  const eng101 = transferable.find(
    (m) =>
      m.cc_prefix === "ENG" &&
      m.cc_number === "101" &&
      m.university === "rutgers-sas",
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101 → Rutgers SAS: ${eng101.univ_course} (${eng101.univ_title})`,
    );
  }
  const mat151 = transferable.find(
    (m) =>
      m.cc_prefix === "MAT" &&
      m.cc_number === "151" &&
      m.university === "njit",
  );
  if (mat151) {
    console.log(
      `  Spot check — MAT 151 → NJIT: ${mat151.univ_course} (${mat151.univ_title})`,
    );
  }

  if (transferable.length === 0) {
    console.log(
      "\nWARNING: No transferable mappings found! Check if NJTransfer.org changed.",
    );
    process.exit(1);
  }

  // --- Write output ---
  const outDir = path.join(process.cwd(), "data", "nj");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  // Merge with existing data (preserve any entries from other sources)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }

  // Replace all NJTransfer-sourced mappings; preserve others
  const njtransferUnivSlugs = new Set(
    Object.values(UNIV_CODE_TO_SLUG),
  );
  const preserved = existing.filter(
    (m) => !njtransferUnivSlugs.has(m.university),
  );
  const merged = [...preserved, ...deduped];

  if (preserved.length > 0) {
    console.log(
      `\nMerged: ${preserved.length} preserved + ${deduped.length} new = ${merged.length} total`,
    );
  }

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nWrote ${deduped.length} NJTransfer mappings to ${outPath}`);
  console.log(`Total in file: ${merged.length}`);

  // --- Supabase import ---
  if (!noImport) {
    try {
      const imported = await importTransfersToSupabase("nj");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  } else {
    console.log("Supabase import skipped (--no-import)");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
