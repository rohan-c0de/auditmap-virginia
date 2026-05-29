/**
 * scrape-transfer-siu.ts
 *
 * Scrapes transfer equivalencies from Southern Illinois University
 * Carbondale's public articulation portal at artic.eis.siu.edu.
 *
 * Three-step session flow per IL community college:
 *   1. POST state=IL to step1.php → institution dropdown
 *   2. POST state+inst_code to step2.php → link to equivalency view
 *   3. GET view1_2012.php?inst_code=<code>&view=1 → HTML table
 *
 * The data table has 11 columns per row:
 *   CRSE | CRSE NUM | CR HRS LOW | CR HRS HIGH | CRSE Title |
 *   SIUC-CRSE | SIUC-CRSE NUM | SIUC-CRSE TITLE | SIUC-CR HRS |
 *   UCC AREA | CURRENT ARTICULATION
 *
 * No login required; session cookies are used across steps.
 *
 * Usage:
 *   npx tsx scripts/il/scrape-transfer-siu.ts
 *   npx tsx scripts/il/scrape-transfer-siu.ts --no-import
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

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

const BASE_URL = "https://artic.eis.siu.edu/articulation-guides";
const DATA_DIR = path.join(process.cwd(), "data", "il");
const OUT_FILE = path.join(DATA_DIR, "transfer-equiv.json");
const INST_FILE = path.join(DATA_DIR, "institutions.json");
const DELAY_MS = 1500;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isElective(prefix: string, number: string): boolean {
  return (
    prefix === "GENL" ||
    number.includes("XX") ||
    number.includes("---")
  );
}

// Actual inst_codes from step1.php dropdown — only IL community colleges.
// Discovered live; names match SIU's labels (may differ from our slugs).
const SIU_CC_CODES: { code: string; name: string }[] = [
  { code: "UIL287", name: "Black Hawk College" },
  { code: "UIL228", name: "Carl Sandburg College" },
  { code: "UIL022", name: "City Colleges of Chicago" },
  { code: "UIL196", name: "College of DuPage" },
  { code: "UIL234", name: "College of Lake County" },
  { code: "UIL322", name: "Danville Area Community College" },
  { code: "UIL220", name: "Elgin Community College" },
  { code: "UIL068", name: "Harper College" },
  { code: "UIL253", name: "Heartland Community College" },
  { code: "UIL318", name: "Highland Community College" },
  { code: "UIL319", name: "Illinois Central College" },
  { code: "UIL284", name: "Illinois Eastern Community Colleges" },
  { code: "UIL238", name: "Illinois Valley Community College" },
  { code: "UIL335", name: "John A Logan College" },
  { code: "UIL004", name: "John Wood Community College" },
  { code: "UIL331", name: "Joliet Junior College" },
  { code: "UIL226", name: "Kankakee Community College" },
  { code: "UIL016", name: "Kaskaskia College" },
  { code: "UIL186", name: "Kishwaukee College" },
  { code: "UIL018", name: "Lake Land College" },
  { code: "UIL263", name: "Lewis & Clark Community College" },
  { code: "UIL304", name: "Lincoln Land Community College" },
  { code: "UIL245", name: "McHenry County College" },
  { code: "UIL072", name: "Moraine Valley Community College" },
  { code: "UIL051", name: "Morton College" },
  { code: "UIL079", name: "Oakton College" },
  { code: "UIL011", name: "Parkland College" },
  { code: "UIL021", name: "Prairie State College" },
  { code: "UIL217", name: "Rend Lake College" },
  { code: "UIL257", name: "Richland Community College" },
  { code: "UIL338", name: "Rock Valley College" },
  { code: "UIL239", name: "Sauk Valley Community College" },
  { code: "UIL280", name: "Shawnee Community College" },
  { code: "UIL062", name: "South Suburban College" },
  { code: "UIL302", name: "Southeastern Illinois College" },
  { code: "UIL293", name: "Southwestern Illinois College" },
  { code: "UIL210", name: "Spoon River College" },
  { code: "UIL064", name: "Triton College" },
  { code: "UIL222", name: "Waubonsee Community College" },
];

// SIU's names don't always match our slugs
const NAME_OVERRIDES: Record<string, string> = {
  "Harper College": "william-rainey-harper-college",
  "City Colleges of Chicago": "city-colleges-of-chicago-kennedy-king-college",
  "Lewis & Clark Community College": "lewis-and-clark-community-college",
  "Oakton College": "oakton-community-college",
};

async function fetchWithCookies(
  url: string,
  opts: RequestInit & { cookies?: string },
): Promise<{ body: string; cookies: string }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    ...(opts.cookies ? { Cookie: opts.cookies } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };

  const resp = await fetch(url, { ...opts, headers, redirect: "follow" });
  const body = await resp.text();

  const setCookies = resp.headers.getSetCookie?.() || [];
  const newCookies = setCookies
    .map((c) => c.split(";")[0])
    .join("; ");

  const merged = opts.cookies
    ? `${opts.cookies}; ${newCookies}`
    : newCookies;

  return { body, cookies: merged };
}

async function scrapeCollege(
  code: string,
  ccSlug: string,
): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];

  // Step 1: POST state=IL
  const step1 = await fetchWithCookies(`${BASE_URL}/step1.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "state=IL",
    cookies: "",
  });

  await sleep(500);

  // Step 2: POST state+inst_code
  const step2 = await fetchWithCookies(`${BASE_URL}/step2.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `state=IL&inst_code=${code}`,
    cookies: step1.cookies,
  });

  await sleep(500);

  // Step 3: GET view1_2012.php
  const viewUrl = `${BASE_URL}/view1_2012.php?inst_code=${code}&view=1`;
  const view = await fetchWithCookies(viewUrl, {
    method: "GET",
    cookies: step2.cookies,
  });

  // Parse the HTML — the data table is the second <table> on the page
  const $ = cheerio.load(view.body);
  const rows = $("tr#resultstable");

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 9) return;

    const ccPrefix = $(cells[0]).text().trim();
    const ccNumber = $(cells[1]).text().trim();
    const ccCredits = $(cells[2]).text().trim();
    const ccTitle = $(cells[4]).text().trim();
    const siucPrefix = $(cells[5]).text().trim();
    const siucNumber = $(cells[6]).text().trim();
    const siucTitle = $(cells[7]).text().trim();
    const siucCredits = $(cells[8]).text().trim();

    if (!ccPrefix || !ccNumber || !siucPrefix) return;

    const univCourse = `${siucPrefix} ${siucNumber}`;
    const elective = isElective(siucPrefix, siucNumber);

    mappings.push({
      state: "il",
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: "siu",
      university_name: "Southern Illinois University Carbondale",
      univ_course: univCourse,
      univ_title: siucTitle,
      univ_credits: siucCredits,
      notes: `[${ccSlug}]`,
      no_credit: false,
      is_elective: elective,
    });
  });

  return mappings;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");

  console.log("SIU Articulation Portal — Illinois Transfer Equivalencies\n");

  // Load our IL institutions for slug matching
  const ourInsts: { id: string; name: string }[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourSlugs = new Set(ourInsts.map((i) => i.id));

  const allMappings: TransferMapping[] = [];
  const successSlugs: string[] = [];

  for (const cc of SIU_CC_CODES) {
    // Match SIU's name to our slug
    let matchedSlug = NAME_OVERRIDES[cc.name] || slugify(cc.name);

    if (!ourSlugs.has(matchedSlug)) {
      for (const s of Array.from(ourSlugs)) {
        if (matchedSlug.includes(s) || s.includes(matchedSlug)) {
          matchedSlug = s;
          break;
        }
      }
    }

    try {
      const mappings = await scrapeCollege(cc.code, matchedSlug);
      allMappings.push(...mappings);
      if (mappings.length > 0) successSlugs.push(matchedSlug);
      console.log(`  ${matchedSlug}: ${mappings.length} mappings`);
    } catch (err) {
      console.error(`  ${matchedSlug}: FAILED — ${(err as Error).message}`);
    }

    await sleep(DELAY_MS);
  }

  // Merge with existing data (preserve non-SIU rows)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
  } catch {
    // empty or missing
  }
  const nonSIU = existing.filter((m) => m.university !== "siu");
  const merged = [...nonSIU, ...allMappings];

  // Summary
  const direct = allMappings.filter((m) => !m.is_elective).length;
  const elective = allMappings.filter((m) => m.is_elective).length;

  console.log(`\n=== Summary ===`);
  console.log(`  SIU mappings: ${allMappings.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  CCs with data: ${successSlugs.length}/${SIU_CC_CODES.length}`);
  console.log(`  Preserved from other sources: ${nonSIU.length}`);
  console.log(`  Total merged: ${merged.length}`);

  // Write
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${OUT_FILE}`);

  if (!skipImport) {
    console.log("\nImporting to Supabase...");
    await importTransfersToSupabase("il");
    console.log("  Done.");
  } else {
    console.log("\nSkipping Supabase import (--no-import).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
