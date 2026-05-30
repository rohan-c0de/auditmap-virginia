/**
 * Scrape Elon University transfer equivalency data.
 *
 * Source: https://www.elon.edu/transferarticulation/
 * ASP.NET WebForms app — requires ViewState handling.
 *
 * Flow:
 *   1. GET page → extract __VIEWSTATE, __EVENTVALIDATION, institution dropdown
 *   2. For each NC community college: POST with institution selected → parse results table
 *
 * Merges mappings into data/nc/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-elon.ts
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

const BASE_URL = "https://www.elon.edu/transferarticulation/";
const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Map Elon's institution names to our college slugs
const COLLEGE_MAP: Record<string, string> = {
  "ALAMANCE COMMUNITY COLLEGE": "alamance",
  "ASHEVILLE-BUNCOMBE TECH COMMUNITY COLLEGE": "asheville-buncombe-technical",
  "BEAUFORT COUNTY COMMUNITY COLL": "beaufort-county",
  "BLADEN COMMUNITY COLLEGE": "bladen",
  "BLUE RIDGE COMMUNITY COLLEGE - NORTH CAROLINA": "blue-ridge",
  "BRUNSWICK COMMUNITY COLLEGE": "brunswick",
  "CALDWELL COMNUNITY COLLEGE TECH INSTITUTE": "caldwell",
  "CAPE FEAR COMMUNITY COLLEGE": "cape-fear",
  "CARTERET COMMUNITY COLLEGE": "carteret",
  "CATAWBA VALLEY COMM COLLEGE": "catawba-valley",
  "CENTRAL CAROLINA COMMUNITY COLLEGE": "central-carolina",
  "CENTRAL PIEDMONT COMMUNITY COLLEGE": "central-piedmont",
  "CLEVELAND COMMUNITY COLLEGE": "cleveland",
  "COASTAL CAROLINA COMMUNITY COLLEGE": "coastal-carolina",
  "COLLEGE ALBEMARLE": "college-of-the-albemarle",
  "CRAVEN COMMUNITY COLLEGE": "craven",
  "DAVIDSON-DAVIE COMM COLLEGE": "davidson-davie",
  "DURHAM TECHNICAL CMTY COLLEGE": "durham-technical",
  "FAYETTEVILLE TECH COMM COLL": "fayetteville-technical",
  "FORSYTH TECHNICAL COMMUNITY COLLEGE": "forsyth-technical",
  "GASTON COLLEGE": "gaston",
  "GUILFORD TECH COMMUNITY COLLEGE": "guilford-technical",
  "HALIFAX COMMUNITY COLLEGE": "halifax",
  "ISOTHERMAL COMMUNITY COLLEGE": "isothermal",
  "JAMES SPRUNT COMMUNITY COLLEGE": "james-sprunt",
  "JOHNSTON COMMUNITY COLLEGE": "johnston",
  "LENOIR COMMUNITY COLLEGE": "lenoir",
  "MARTIN COMMUNITY COLLEGE": "martin",
  "MAYLAND COMMUNITY COLLEGE": "mayland",
  "MCDOWELL TECHNICAL COMM COLLEGE": "mcdowell-technical",
  "MITCHELL COMMUNITY COLLEGE": "mitchell",
  "NASH COMMUNITY COLLEGE": "nash",
  "PAMLICO COMMUNITY COLLEGE": "pamlico",
  "PIEDMONT COMMUNITY COLLEGE": "piedmont",
  "PITT COMMUNITY COLLEGE": "pitt",
  "RANDOLPH COMMUNITY COLLEGE": "randolph",
  "RICHMOND COMMUNITY COLLEGE": "richmond",
  "ROBESON COMMUNITY COLLEGE": "robeson",
  "ROCKINGHAM COMMUNITY COLLEGE": "rockingham",
  "ROWAN-CABARRUS COMMUNITY COLLEGE": "rowan-cabarrus",
  "SAMPSON COMMUNITY COLLEGE": "sampson",
  "SANDHILLS COMMUNITY COLLEGE": "sandhills",
  "SOUTH PIEDMONT COMMUNITY COLLEGE": "south-piedmont",
  "SOUTHEASTERN COMMUNITY COLLEGE": "southeastern",
  "SOUTHWESTERN COMMUNITY COLLEGE": "southwestern",
  "STANLY COMMUNITY COLLEGE": "stanly",
  "SURRY COMMUNITY COLLEGE": "surry",
  "TRI-COUNTY COMMUNITY COLLEGE": "tri-county",
  "VANCE-GRANVILLE COMMUNITY COLLEGE": "vance-granville",
  "WAKE TECHNICAL COMMUNITY COLLEGE": "wake-technical",
  "WAYNE COMMUNITY COLLEGE": "wayne",
  "WESTERN PIEDMONT COMM COLLEGE": "western-piedmont",
  "WILKES COMMUNITY COLLEGE": "wilkes",
  "WILSON COMMUNITY COLLEGE": "wilson",
};

async function fetchInitialPage(): Promise<{
  viewState: string;
  eventValidation: string;
  viewStateGenerator: string;
  institutions: { name: string; value: string }[];
  cookies: string;
}> {
  const res = await fetch(BASE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AuditMap/1.0)",
    },
  });
  const cookies = res.headers.get("set-cookie") || "";
  const html = await res.text();
  const $ = cheerio.load(html);

  const viewState = $("#__VIEWSTATE").val() as string || "";
  const eventValidation = $("#__EVENTVALIDATION").val() as string || "";
  const viewStateGenerator = $("#__VIEWSTATEGENERATOR").val() as string || "";

  // Extract NC institutions from dropdown
  const institutions: { name: string; value: string }[] = [];
  // First we need to select country=US and state=NC to populate the dropdown
  // For now, get all option values — we'll select NC state via POST

  return { viewState, eventValidation, viewStateGenerator, institutions, cookies };
}

async function postForm(
  formData: Record<string, string>,
  cookies: string
): Promise<{ html: string; viewState: string; eventValidation: string; viewStateGenerator: string; newCookies: string }> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(formData)) {
    body.append(key, value);
  }

  // ASP.NET form action is "./" (self-referencing)
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; AuditMap/1.0)",
      Cookie: cookies,
      Referer: BASE_URL,
    },
    body: body.toString(),
    redirect: "follow",
  });

  const newCookies = res.headers.get("set-cookie") || cookies;
  const html = await res.text();
  const $ = cheerio.load(html);

  return {
    html,
    viewState: $("#__VIEWSTATE").val() as string || "",
    eventValidation: $("#__EVENTVALIDATION").val() as string || "",
    viewStateGenerator: $("#__VIEWSTATEGENERATOR").val() as string || "",
    newCookies,
  };
}

function parseResultsTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // The results table is gvCourses
  const rows = $("#MainContent_gvCourses tr").toArray();

  for (let i = 1; i < rows.length; i++) { // skip header row
    const tds = $(rows[i]).find("td");
    if (tds.length < 7) continue;

    const ccCourse = $(tds[0]).text().trim();
    const ccCredits = $(tds[1]).text().trim().replace(/\.0+$/, "");
    const ccTitle = $(tds[2]).text().trim();
    const univCourse = $(tds[3]).text().trim();
    const univCredits = $(tds[4]).text().trim().replace(/\.0+$/, "");
    const univTitle = $(tds[5]).text().trim();
    const notes = $(tds[6]).text().trim();

    if (!ccCourse) continue;

    // Parse cc course: "WEB 115" → prefix=WEB, number=115
    const courseMatch = ccCourse.match(/^([A-Z]{2,4})\s*(\d{3}[A-Z]?)$/);
    if (!courseMatch) continue;

    const isElective = univCourse.toLowerCase().includes("elective") ||
      univTitle.toLowerCase().includes("elective");
    const noCredit = univCourse.toLowerCase().includes("no credit") ||
      univTitle.toLowerCase().includes("no credit") ||
      univCourse === "0" || univCourse === "";

    mappings.push({
      cc_prefix: courseMatch[1],
      cc_number: courseMatch[2],
      cc_course: `${courseMatch[1]} ${courseMatch[2]}`,
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: "elon",
      university_name: "Elon University",
      univ_course: univCourse,
      univ_title: univTitle,
      univ_credits: univCredits,
      notes,
      no_credit: noCredit,
      is_elective: isElective,
    });
  }

  return mappings;
}

async function main() {
  console.log("Elon University Transfer Equivalency Scraper\n");

  // Step 1: Fetch initial page
  console.log("Fetching initial page...");
  const initial = await fetchInitialPage();
  let { viewState, eventValidation, viewStateGenerator, cookies } = initial;

  if (!viewState) {
    console.error("Failed to get ViewState from initial page");
    process.exit(1);
  }
  console.log(`  ViewState: ${viewState.length} chars`);
  console.log(`  EventValidation: ${eventValidation.length} chars`);

  // Step 2: Select country = United States, state = NC
  console.log("\nSelecting United States...");
  let result = await postForm({
    __VIEWSTATE: viewState,
    __EVENTVALIDATION: eventValidation,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    "ctl00$MainContent$ddlCountry": "United States of America",
    "ctl00$MainContent$ddlState": "",
    "ctl00$MainContent$ddlInstitution": "",
    "ctl00$MainContent$rblDateAndLocation": "0",
    __EVENTTARGET: "ctl00$MainContent$ddlCountry",
    __EVENTARGUMENT: "",
  }, cookies);
  viewState = result.viewState;
  eventValidation = result.eventValidation;
  viewStateGenerator = result.viewStateGenerator;
  cookies = result.newCookies;
  await sleep(DELAY_MS);

  console.log("Selecting NC...");
  result = await postForm({
    __VIEWSTATE: viewState,
    __EVENTVALIDATION: eventValidation,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    "ctl00$MainContent$ddlCountry": "United States of America",
    "ctl00$MainContent$ddlState": "NC",
    "ctl00$MainContent$ddlInstitution": "",
    "ctl00$MainContent$rblDateAndLocation": "0",
    __EVENTTARGET: "ctl00$MainContent$ddlState",
    __EVENTARGUMENT: "",
  }, cookies);
  viewState = result.viewState;
  eventValidation = result.eventValidation;
  viewStateGenerator = result.viewStateGenerator;
  cookies = result.newCookies;
  await sleep(DELAY_MS);

  // Extract institution names from dropdown
  const $ = cheerio.load(result.html);
  const institutionOptions: { name: string; value: string }[] = [];
  $("#MainContent_ddlInstitution option").each((_, el) => {
    const val = $(el).attr("value") || "";
    const name = $(el).text().trim();
    if (val && name && name !== "Select an Institution") {
      institutionOptions.push({ name, value: val });
    }
  });

  // Filter to just community colleges
  const ccOptions = institutionOptions.filter(
    (opt) => COLLEGE_MAP[opt.name] !== undefined
  );
  console.log(`\nFound ${institutionOptions.length} NC institutions, ${ccOptions.length} are community colleges\n`);

  // Log any we didn't map
  const unmapped = institutionOptions.filter((opt) => !COLLEGE_MAP[opt.name]);
  if (unmapped.length > 0) {
    console.log("  Unmapped institutions (not community colleges):");
    unmapped.forEach((opt) => console.log(`    - ${opt.name}`));
    console.log();
  }

  // Step 3: For each CC, select it and scrape results
  const allMappings: TransferMapping[] = [];
  let totalParsed = 0;

  for (let i = 0; i < ccOptions.length; i++) {
    const opt = ccOptions[i];
    const slug = COLLEGE_MAP[opt.name];
    process.stdout.write(`  [${i + 1}/${ccOptions.length}] ${opt.name}`);

    result = await postForm({
      __VIEWSTATE: viewState,
      __EVENTVALIDATION: eventValidation,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      "ctl00$MainContent$ddlCountry": "United States of America",
      "ctl00$MainContent$ddlState": "NC",
      "ctl00$MainContent$ddlInstitution": opt.value,
      "ctl00$MainContent$rblDateAndLocation": "0",
      __EVENTTARGET: "ctl00$MainContent$ddlInstitution",
      __EVENTARGUMENT: "",
    }, cookies);
    viewState = result.viewState;
    eventValidation = result.eventValidation;
    viewStateGenerator = result.viewStateGenerator;
    cookies = result.newCookies;

    const mappings = parseResultsTable(result.html);
    allMappings.push(...mappings);
    totalParsed += mappings.length;
    console.log(` → ${mappings.length} mappings`);

    await sleep(DELAY_MS);
  }

  console.log(`\nTotal: ${allMappings.length} mappings from ${ccOptions.length} colleges`);

  if (allMappings.length === 0) {
    console.log("No mappings found — check if ASP.NET form handling needs adjustment");
    process.exit(1);
  }

  // Step 4: Merge into transfer-equiv.json
  const equivPath = path.join(process.cwd(), "data", "nc", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  if (fs.existsSync(equivPath)) {
    existing = JSON.parse(fs.readFileSync(equivPath, "utf-8"));
  }

  // Remove old Elon data
  const withoutElon = existing.filter((m) => m.university !== "elon");
  const merged = [...withoutElon, ...allMappings];

  // Sort
  merged.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university)
  );

  fs.writeFileSync(equivPath, JSON.stringify(merged, null, 2));
  console.log(`\nSaved ${merged.length} total mappings (${allMappings.length} Elon + ${withoutElon.length} existing)`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
