/**
 * Scrape NC State University transfer equivalency data for NCCCS courses.
 *
 * Source: https://webappprd.acs.ncsu.edu/php/transfer/
 * Uses the PHP API endpoints directly — no browser needed.
 *
 * API flow:
 *   1. POST ext_transfer_instiutions.php (state=NC&country=USA) → institution list
 *   2. POST ext_transfer_inst_courses.php (inst={code}&dept=1&hist=0&cred=1) → all equivalencies
 *
 * NCCCS courses are standardized, so the result is the same regardless of
 * which community college is used as the source institution.
 *
 * Merges mappings into data/nc/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-ncstate.ts
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

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

const BASE_URL = "https://webappprd.acs.ncsu.edu/php/transfer";
// Wake Tech's institution code — result is the same for all NCCCS colleges
const WAKE_TECH_CODE = "000219496";

async function fetchEquivalencies(): Promise<string> {
  console.log("Fetching all NCCCS equivalencies from NC State...");
  const res = await fetch(`${BASE_URL}/ext_transfer_inst_courses.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `inst=${WAKE_TECH_CODE}&dept=1&hist=0&cred=1`,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const html = data.course_html;
  if (!html) throw new Error("No course_html in response");
  return html;
}

function parseRows(html: string): TransferMapping[] {
  const $ = cheerio.load(`<table>${html}</table>`);
  const mappings: TransferMapping[] = [];

  $("tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 7) return;

    const ccCourseRaw = $(tds[0]).text().trim();
    const ccTitle = $(tds[1]).text().trim();
    // tds[2] = effective dates
    const ccCredits = $(tds[3]).text().trim();
    // tds[4] = approval date
    const ncsuEquivHtml = $(tds[5]).html() || "";
    // Replace <br> with space before extracting text so "BIO 105<br>AND<br>BIO 106" → "BIO 105 AND BIO 106"
    const cleanedHtml = ncsuEquivHtml.replace(/<br\s*\/?>/gi, " ");
    const ncsuEquivText = cheerio.load(cleanedHtml).text().trim().replace(/\s+/g, " ");
    const ncsuCredits = $(tds[6]).text().trim().replace(/\s+/g, " ");

    if (!ccCourseRaw) return;

    // Parse CC course: "ACC 120" → prefix + number
    const parts = ccCourseRaw.match(/^([A-Z]{2,4})\s+(\S+)$/);
    if (!parts) return;

    const prefix = parts[1];
    const number = parts[2];

    // Extract NCSU equivalent courses from links or text
    const $equiv = cheerio.load(ncsuEquivHtml);
    const links = $equiv("a.req-course-link");
    let univCourse = "";

    if (links.length > 0) {
      // Collect all linked courses
      const courseParts: string[] = [];
      links.each((_, link) => {
        const text = $equiv(link).text().trim();
        if (text) courseParts.push(text);
      });
      univCourse = courseParts.join(" & ");
    } else {
      univCourse = ncsuEquivText;
    }

    // Credits come space-separated for compound equivalencies (e.g. "1 3" for "ACC *** AND ACC 210")
    const creditParts = ncsuCredits.split(/\s+/);

    // Handle "AND" compound equivalencies (e.g. "ACC *** AND ACC 210")
    // If mix of elective (***) and specific courses, prefer the specific one
    let finalCredits = ncsuCredits;
    if (ncsuEquivText.includes(" AND ")) {
      const andParts = ncsuEquivText.split(/\s+AND\s+/);
      const specificParts: string[] = [];
      const specificCredits: string[] = [];
      andParts.forEach((p, idx) => {
        const isElec = p.includes("***") || p.includes("**");
        if (!isElec) {
          specificParts.push(p.trim());
          if (creditParts[idx]) specificCredits.push(creditParts[idx]);
        }
      });
      if (specificParts.length > 0 && specificParts.length < andParts.length) {
        // Mix of elective + specific → use only specific courses and their credits
        univCourse = specificParts.join(" & ");
        finalCredits = specificCredits.join(" + ");
      } else if (specificParts.length === andParts.length) {
        // All specific → join them, sum credits
        univCourse = specificParts.join(" & ");
        const total = creditParts.reduce((sum, c) => sum + (parseInt(c, 10) || 0), 0);
        finalCredits = String(total);
      }
      // If all elective, keep the full text and original credits
    } else if (creditParts.length === 1) {
      finalCredits = creditParts[0];
    }

    // Detect no credit
    const noCredit =
      ncsuEquivText === "" ||
      ncsuEquivText.includes("No Credit") ||
      ncsuEquivText.includes("Does Not Transfer");

    // Detect elective: "***" or "**" or "GEP" patterns
    const isElective =
      !noCredit &&
      (univCourse.includes("***") ||
        univCourse.includes("**") ||
        univCourse.includes("GEP") ||
        univCourse.startsWith("TR ") ||
        univCourse.includes("1XX") ||
        univCourse.includes("2XX"));

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: `${prefix} ${number}`,
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: "ncstate",
      university_name: "NC State University",
      univ_course: noCredit ? "" : univCourse,
      univ_title: noCredit ? "No NCSU credit" : univCourse,
      univ_credits: noCredit ? "" : finalCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective && !noCredit,
    });
  });

  return mappings;
}

async function main() {
  console.log("NC State Transfer Equivalency Scraper\n");

  const html = await fetchEquivalencies();
  console.log(`  Received ${html.length} bytes of HTML`);

  const mappings = parseRows(html);

  if (mappings.length === 0) {
    console.log("No mappings found! Check if the API changed.");
    process.exit(1);
  }

  // Stats
  const direct = mappings.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = mappings.filter((m) => !m.no_credit && m.is_elective).length;
  const noCredit = mappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(mappings.map((m) => m.cc_prefix));

  console.log(`\nNC State Summary:`);
  console.log(`  Total mappings: ${mappings.length}`);
  console.log(`  Direct equivalencies: ${direct}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = mappings.find((m) => m.cc_prefix === "ENG" && m.cc_number === "111");
  if (eng111) console.log(`\n  Spot check — ENG 111: → ${eng111.univ_course} (elective=${eng111.is_elective})`);
  const bio110 = mappings.find((m) => m.cc_prefix === "BIO" && m.cc_number === "110");
  if (bio110) console.log(`  Spot check — BIO 110: → ${bio110.univ_course} (elective=${bio110.is_elective})`);
  const acc120 = mappings.find((m) => m.cc_prefix === "ACC" && m.cc_number === "120");
  if (acc120) console.log(`  Spot check — ACC 120: → ${acc120.univ_course} (elective=${acc120.is_elective})`);

  // Merge with existing data
  const outPath = path.join(process.cwd(), "data", "nc", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  const nonNcstate = existing.filter((m) => m.university !== "ncstate");
  const merged = [...nonNcstate, ...mappings];

  console.log(`Merged: ${nonNcstate.length} existing (non-NCSU) + ${mappings.length} NCSU = ${merged.length} total`);

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
