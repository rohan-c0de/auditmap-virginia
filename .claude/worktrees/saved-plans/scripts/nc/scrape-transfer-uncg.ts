/**
 * Scrape UNC Greensboro transfer equivalency data for NCCCS courses.
 *
 * Source: https://transfercreditplanner.uncg.edu/
 * Uses form POST with CSRF token — no browser needed.
 *
 * API flow:
 *   1. GET / → extract __RequestVerificationToken + FICE codes from dropdown
 *   2. POST / with SelectedStateCode=NC&SelectedInstitutionCode={fice}&token → HTML with transfer table
 *
 * Merges mappings into data/nc/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-uncg.ts
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

const BASE_URL = "https://transfercreditplanner.uncg.edu";
// Wake Tech's FICE code in UNCG's system
const WAKE_TECH_FICE = "5928";

async function fetchFormPage(): Promise<{ token: string; html: string }> {
  console.log("Fetching UNCG Transfer Credit Planner form...");
  const res = await fetch(BASE_URL + "/");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').val() as string;
  if (!token) throw new Error("Could not find __RequestVerificationToken");

  // Extract cookies from response
  const cookies = res.headers.getSetCookie?.() || [];
  return { token, html: cookies.join("; ") };
}

async function fetchEquivalencies(token: string, cookies: string): Promise<string> {
  console.log("Fetching Wake Tech → UNCG equivalencies...");
  const res = await fetch(BASE_URL + "/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: `SelectedStateCode=NC&SelectedInstitutionCode=${WAKE_TECH_FICE}&__RequestVerificationToken=${encodeURIComponent(token)}`,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseRows(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find all table rows (skip header)
  $("table tr").each((i, row) => {
    if (i === 0) return; // skip header

    const tds = $(row).find("td");
    if (tds.length < 6) return;

    // Columns: [checkbox, CC course, CC title, UNCG course, UNCG title, credits, notes]
    const ccCourseRaw = $(tds[1]).text().trim().replace(/\s+/g, " ");
    const ccTitle = $(tds[2]).text().trim().replace(/\s+/g, " ");
    const uncgCourse = $(tds[3]).text().trim().replace(/\s+/g, " ");
    const uncgTitle = $(tds[4]).text().trim().replace(/\s+/g, " ");
    const credits = $(tds[5]).text().trim().replace(/\s+/g, " ");
    const notes = tds.length > 6 ? $(tds[6]).text().trim() : "";

    if (!ccCourseRaw) return;

    // Parse CC course: "ACC 120" → prefix + number
    const parts = ccCourseRaw.match(/^([A-Z]{2,4})\s+(\S+)$/);
    if (!parts) return;

    const prefix = parts[1];
    const number = parts[2];

    // Detect no credit
    const noCredit =
      uncgCourse === "" ||
      uncgCourse.includes("No Credit") ||
      uncgCourse.includes("Does Not Transfer");

    // Detect elective: "ELE 1XX", "XXX", "2XX" patterns
    const isElective =
      !noCredit &&
      (uncgCourse.includes("XX") ||
        uncgCourse.includes("ELE") ||
        uncgTitle.toLowerCase().includes("elective"));

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: `${prefix} ${number}`,
      cc_title: ccTitle,
      cc_credits: credits,
      university: "uncg",
      university_name: "UNC Greensboro",
      univ_course: noCredit ? "" : uncgCourse,
      univ_title: noCredit ? "No UNCG credit" : uncgTitle || uncgCourse,
      univ_credits: noCredit ? "" : credits,
      notes,
      no_credit: noCredit,
      is_elective: isElective && !noCredit,
    });
  });

  return mappings;
}

async function main() {
  console.log("UNCG Transfer Equivalency Scraper\n");

  // Step 1: Get form token and cookies
  const { token, html: cookies } = await fetchFormPage();
  console.log(`  Got CSRF token (${token.slice(0, 20)}...)`);

  // Step 2: Fetch equivalencies
  const html = await fetchEquivalencies(token, cookies);
  console.log(`  Received ${html.length} bytes of HTML`);

  // Step 3: Parse
  const mappings = parseRows(html);

  if (mappings.length === 0) {
    console.log("No mappings found! Check if the page structure changed.");
    process.exit(1);
  }

  // Deduplicate — same CC course may appear multiple times if it maps to
  // different UNCG equivalents depending on context. Keep all unique mappings.
  const seen = new Set<string>();
  const deduped = mappings.filter((m) => {
    const key = `${m.cc_course}→${m.univ_course}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Stats
  const direct = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log(`\nUNCG Summary:`);
  console.log(`  Total mappings: ${deduped.length} (${mappings.length} before dedup)`);
  console.log(`  Direct equivalencies: ${direct}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = deduped.find((m) => m.cc_prefix === "ENG" && m.cc_number === "111");
  if (eng111) console.log(`\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`);
  const bio110 = deduped.find((m) => m.cc_prefix === "BIO" && m.cc_number === "110");
  if (bio110) console.log(`  Spot check — BIO 110: → ${bio110.univ_course} (${bio110.univ_title})`);
  const acc120 = deduped.find((m) => m.cc_prefix === "ACC" && m.cc_number === "120");
  if (acc120) console.log(`  Spot check — ACC 120: → ${acc120.univ_course} (${acc120.univ_title})`);

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

  const nonUncg = existing.filter((m) => m.university !== "uncg");
  const merged = [...nonUncg, ...deduped];

  console.log(`Merged: ${nonUncg.length} existing (non-UNCG) + ${deduped.length} UNCG = ${merged.length} total`);

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
