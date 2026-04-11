/**
 * scrape-transfer-ccsu.ts
 *
 * Scrapes Central Connecticut State University's transfer course equivalency
 * tool at webapps.ccsu.edu to extract CT State CC -> CCSU mappings.
 *
 * CCSU's tool is an ASP.NET WebForms page. The results are server-side
 * paginated (50 rows per page) and ASP.NET postback paging is unreliable
 * with stateless fetch requests. To work around this, we iterate through
 * the alphabet (A-Z) using the subject prefix filter. For letters that
 * still return paginated results (>50 rows), we split into 2-letter
 * combos (e.g., "CA", "CB", ..., "CZ"). This ensures we capture all
 * equivalencies without needing server-side pagination.
 *
 * Each request requires a fresh GET to extract __VIEWSTATE +
 * __EVENTVALIDATION, then a POST with the search parameters.
 *
 * The result table has 9 columns:
 *   Subject Code | Course Number | Course Title | Course Credits |
 *   CCSU Subject Code | CCSU Course Number | CCSU Course Title | CCSU Credits |
 *   *General Education Areas
 *
 * Note: The search matches both CC and CCSU subject codes (prefix match),
 * so searching "B" returns BIO courses (CC side) and also courses that
 * map to CCSU subjects starting with B.
 *
 * Usage:
 *   npx tsx scripts/ct/scrape-transfer-ccsu.ts
 *   npx tsx scripts/ct/scrape-transfer-ccsu.ts --no-import
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://webapps.ccsu.edu/ctab/CCSUF_TransCourses.aspx";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// CT State CC is the merged community college (all 12 former campuses).
// The value in CCSU's dropdown has a leading space: " CT State Community College"
const CT_STATE_VALUE = " CT State Community College";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
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
        console.error(`  ${label}: HTTP ${res.status}`);
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// ASP.NET ViewState extraction
// ---------------------------------------------------------------------------

interface AspNetState {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}

function extractAspNetState(html: string): AspNetState {
  const $ = cheerio.load(html);
  const viewState = $("#__VIEWSTATE").attr("value") || "";
  const viewStateGenerator = $("#__VIEWSTATEGENERATOR").attr("value") || "";
  const eventValidation = $("#__EVENTVALIDATION").attr("value") || "";

  if (!viewState || !eventValidation) {
    throw new Error(
      "Failed to extract ASP.NET __VIEWSTATE or __EVENTVALIDATION",
    );
  }

  return { viewState, viewStateGenerator, eventValidation };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Check if the response contains pagination (ASP.NET GridView pager).
 * The pager row has links like "javascript:__doPostBack('gvCourse','Page$2')"
 */
function hasPagination(html: string): boolean {
  return html.includes("__doPostBack('gvCourse','Page$");
}

function parseEquivalencyTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  const table = $("#gvCourse");
  if (!table.length) {
    return mappings;
  }

  // Skip header row and pager row, iterate data rows
  table.find("tr").each((idx, row) => {
    if (idx === 0) return; // header row

    const cells = $(row).find("td");
    if (cells.length < 8) return;

    // Skip pager rows (they contain <a> tags with __doPostBack or <span> for current page)
    const firstCellHtml = $(cells[0]).html() || "";
    if (
      firstCellHtml.includes("__doPostBack") ||
      (cells.length <= 11 && $(cells[0]).find("span").length > 0 && $(cells[0]).text().trim().match(/^\d+$/))
    ) {
      return;
    }

    // Columns: 0=CC Subject, 1=CC Number, 2=CC Title, 3=CC Credits,
    //          4=CCSU Subject, 5=CCSU Number, 6=CCSU Title, 7=CCSU Credits,
    //          8=Gen Ed Areas (optional)
    const ccPrefix = $(cells[0]).text().trim();
    const ccNumber = $(cells[1]).text().trim();
    const ccTitle = $(cells[2]).text().trim();
    const ccCredits = $(cells[3]).text().trim();
    const univPrefix = $(cells[4]).text().trim();
    const univNumber = $(cells[5]).text().trim();
    const univTitle = $(cells[6]).text().trim();
    const univCredits = $(cells[7]).text().trim();
    const genEd =
      cells.length >= 9
        ? $(cells[8])
            .text()
            .trim()
            .replace(/&nbsp;?/g, "")
            .trim()
        : "";

    // Validate that this is actual course data
    if (!ccPrefix || !ccNumber) return;
    // CC prefix should be 2-5 uppercase letters
    if (!/^[A-Z]{2,5}$/.test(ccPrefix)) return;
    // CC number should be numeric (possibly with a letter suffix)
    if (!/^\d{3,4}[A-Z]?$/.test(ccNumber)) return;

    const univCourse =
      univPrefix && univNumber ? `${univPrefix} ${univNumber}` : "";

    // Detect no-credit / elective
    const noCredit =
      univCredits === "0" ||
      univTitle.toUpperCase().includes("NOT ACCEPTABLE") ||
      univTitle.toUpperCase().includes("NO CREDIT") ||
      univTitle.toUpperCase().includes("NOT TRANSFERABLE") ||
      univTitle.toUpperCase().includes("REMEDIAL") ||
      (!univPrefix && !univNumber);

    const isElective =
      univNumber === "000" ||
      univNumber === "0000" ||
      univTitle.toUpperCase().includes("ELECTIVE") ||
      univPrefix === "ELEC" ||
      univPrefix === "ELE";

    // Build notes
    const notesParts: string[] = [];
    if (genEd) {
      notesParts.push(`Gen Ed: ${genEd}`);
    }
    const notes = notesParts.join("; ");

    mappings.push({
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: "ccsu",
      university_name: "Central Connecticut State University",
      univ_course: noCredit ? "" : univCourse,
      univ_title: noCredit ? univTitle || "No CCSU credit" : univTitle,
      univ_credits: univCredits,
      notes,
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Perform a single search query against the CCSU form.
 * Each request needs a fresh GET (for ViewState) + POST.
 */
async function searchByPrefix(subjectPrefix: string): Promise<{
  mappings: TransferMapping[];
  paginated: boolean;
}> {
  // Fresh GET for ViewState
  const formHtml = await retryFetch(
    BASE_URL,
    `ccsu-form(${subjectPrefix})`,
  );
  if (!formHtml) return { mappings: [], paginated: false };

  const aspState = extractAspNetState(formHtml);

  // POST with search
  const formData = new URLSearchParams();
  formData.append("__VIEWSTATE", aspState.viewState);
  formData.append("__VIEWSTATEGENERATOR", aspState.viewStateGenerator);
  formData.append("__EVENTVALIDATION", aspState.eventValidation);
  formData.append("cboSBGI", CT_STATE_VALUE);
  formData.append("txtSubj", subjectPrefix);
  formData.append("txtNumb", "");
  formData.append("btnSearch", "Search");

  const resultHtml = await retryFetch(
    BASE_URL,
    `ccsu-results(${subjectPrefix})`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    },
  );

  if (!resultHtml) return { mappings: [], paginated: false };

  const mappings = parseEquivalencyTable(resultHtml);
  const paginated = hasPagination(resultHtml);

  return { mappings, paginated };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scrapeCCSU(): Promise<TransferMapping[]> {
  console.log("CCSU Transfer Equivalency Scraper");
  console.log(`  Source: ${BASE_URL}`);
  console.log(`  Institution: CT State Community College`);
  console.log(`  Strategy: iterate A-Z subject prefixes (split if paginated)\n`);

  const allMappings: TransferMapping[] = [];
  let requestCount = 0;

  for (const letter of ALPHABET) {
    const { mappings, paginated } = await searchByPrefix(letter);
    requestCount++;

    if (paginated) {
      // This letter has >50 results. Split into 2-letter combos.
      console.log(
        `  ${letter}: ${mappings.length}+ rows (paginated), splitting into ${letter}A-${letter}Z...`,
      );
      // Still collect what we got from the first page
      // but also query each 2-letter combo to ensure complete coverage
      const twoLetterMappings: TransferMapping[] = [];

      for (const second of ALPHABET) {
        const combo = `${letter}${second}`;
        const sub = await searchByPrefix(combo);
        requestCount++;

        if (sub.mappings.length > 0) {
          console.log(`    ${combo}: ${sub.mappings.length} rows${sub.paginated ? " (still paginated!)" : ""}`);
        }
        twoLetterMappings.push(...sub.mappings);

        if (sub.paginated) {
          // Very unlikely with 2-letter prefix, but log a warning
          console.warn(
            `    WARNING: ${combo} is still paginated, some results may be missing`,
          );
        }

        await sleep(DELAY_MS);
      }

      allMappings.push(...twoLetterMappings);
    } else {
      if (mappings.length > 0) {
        console.log(`  ${letter}: ${mappings.length} rows`);
      }
      allMappings.push(...mappings);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n  Total requests: ${requestCount}`);
  console.log(`  Total raw mappings: ${allMappings.length}`);

  // Deduplicate — the same course can appear in multiple letter searches
  // since the search matches both CC and CCSU subject codes.
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // Stats
  const directEquiv = deduped.filter(
    (m) => !m.no_credit && !m.is_elective,
  ).length;
  const electives = deduped.filter(
    (m) => !m.no_credit && m.is_elective,
  ).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log("\n  Summary:");
  console.log(`    Direct equivalencies: ${directEquiv}`);
  console.log(`    Elective credit: ${electives}`);
  console.log(`    No credit: ${noCreditCount}`);
  console.log(`    Subject prefixes: ${prefixes.size}`);

  // Spot checks
  const eng101 = deduped.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "101",
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101: -> ${eng101.univ_course} (${eng101.univ_title})`,
    );
  }
  const mat137 = deduped.find(
    (m) => m.cc_prefix === "MAT" && m.cc_number === "137",
  );
  if (mat137) {
    console.log(
      `  Spot check — MAT 137: -> ${mat137.univ_course} (${mat137.univ_title})`,
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

  const mappings = await scrapeCCSU();

  if (mappings.length === 0) {
    console.error("\nNo mappings found! Check if the CCSU form changed.");
    process.exit(1);
  }

  // Write to data file (merge with existing)
  const outDir = path.join(process.cwd(), "data", "ct");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }

  const nonCcsu = existing.filter((m) => m.university !== "ccsu");
  const merged = [...nonCcsu, ...mappings];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} CCSU mappings to ${outPath}`);
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
