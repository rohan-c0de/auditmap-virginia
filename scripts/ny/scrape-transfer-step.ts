/**
 * scrape-transfer-step.ts — SUNY CC → 4-year SUNY equivalencies
 *
 * Scrapes the SUNY Transfer Equivalency Platform (STEP) at
 * https://step.transfer.suny.edu to extract course-level transfer
 * mappings from SUNY community colleges to SUNY four-year campuses.
 *
 * STEP is a WordPress site with server-rendered HTML. No login required.
 * Three-level drill-down per source CC:
 *   1. GET /transfer-out/?inst=<id>          → subject codes (<option> list)
 *   2. GET /transfer-out/?inst=<id>&sub=X    → course numbers (<option> list)
 *   3. GET /transfer-out/?inst=<id>&sub=X&num=Y → results table (HTML rows)
 *
 * Coverage: ~30 SUNY CCs → ~29 SUNY 4-year campuses.
 * Output merges into data/ny/transfer-equiv.json alongside CUNY T-Rex data.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-transfer-step.ts
 *   npx tsx scripts/ny/scrape-transfer-step.ts --cc broome
 *   npx tsx scripts/ny/scrape-transfer-step.ts --no-import
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = "https://step.transfer.suny.edu";
const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";
const CONCURRENCY = 4;
const DELAY_MS = 400;

// SUNY community colleges — source institutions we scrape FROM.
// inst IDs from the <select> on /transfer-out/.
const SOURCE_CCS: Record<string, { instId: string; name: string }> = {
  adirondack:           { instId: "188438", name: "Adirondack" },
  broome:               { instId: "189547", name: "Broome" },
  cayuga:               { instId: "189839", name: "Cayuga" },
  clinton:              { instId: "190053", name: "Clinton" },
  "columbia-greene":    { instId: "190169", name: "Columbia-Greene" },
  corning:              { instId: "190442", name: "Corning" },
  dutchess:             { instId: "190840", name: "Dutchess" },
  erie:                 { instId: "191083", name: "Erie" },
  "finger-lakes":       { instId: "191199", name: "Finger Lakes" },
  "fulton-montgomery":  { instId: "191302", name: "Fulton-Montgomery" },
  genesee:              { instId: "191339", name: "Genesee" },
  herkimer:             { instId: "191612", name: "Herkimer" },
  "hudson-valley":      { instId: "191719", name: "Hudson Valley" },
  jamestown:            { instId: "191986", name: "Jamestown" },
  jefferson:            { instId: "192022", name: "Jefferson" },
  "mohawk-valley":      { instId: "193283", name: "Mohawk Valley" },
  monroe:               { instId: "193326", name: "Monroe" },
  nassau:               { instId: "193478", name: "Nassau" },
  niagara:              { instId: "193946", name: "Niagara" },
  "north-country":      { instId: "194028", name: "North Country" },
  onondaga:             { instId: "194222", name: "Onondaga" },
  "orange-county":      { instId: "194240", name: "Orange County" },
  rockland:             { instId: "195058", name: "Rockland" },
  schenectady:          { instId: "195322", name: "Schenectady" },
  suffolk:              { instId: "366395", name: "Suffolk" },
  sullivan:             { instId: "195988", name: "Sullivan" },
  "tompkins-cortland":  { instId: "196565", name: "Tompkins Cortland" },
  ulster:               { instId: "196699", name: "Ulster" },
  westchester:          { instId: "197294", name: "Westchester" },
  "fashion-institute":  { instId: "191126", name: "Fashion Institute" },
};

// SUNY 4-year campuses — destinations. Used to filter results (we only keep
// rows whose campus name maps to a known 4-year). Campus names come from
// the results table text, which may differ slightly from the dropdown.
const DEST_4YR: Record<string, { slug: string; name: string }> = {
  Albany:               { slug: "suny-albany", name: "University at Albany" },
  "Alfred State":       { slug: "suny-alfred-state", name: "Alfred State" },
  Binghamton:           { slug: "suny-binghamton", name: "Binghamton University" },
  Brockport:            { slug: "suny-brockport", name: "SUNY Brockport" },
  "Buffalo State":      { slug: "suny-buffalo-state", name: "Buffalo State University" },
  Canton:               { slug: "suny-canton", name: "SUNY Canton" },
  Cobleskill:           { slug: "suny-cobleskill", name: "SUNY Cobleskill" },
  Cortland:             { slug: "suny-cortland", name: "SUNY Cortland" },
  Delhi:                { slug: "suny-delhi", name: "SUNY Delhi" },
  "Downstate Medical":  { slug: "suny-downstate", name: "SUNY Downstate Health Sciences" },
  "Empire State":       { slug: "suny-empire-state", name: "SUNY Empire State" },
  "Env Sci and Forestry": { slug: "suny-esf", name: "SUNY College of Environmental Science and Forestry" },
  Farmingdale:          { slug: "suny-farmingdale", name: "Farmingdale State College" },
  Fredonia:             { slug: "suny-fredonia", name: "SUNY Fredonia" },
  Geneseo:              { slug: "suny-geneseo", name: "SUNY Geneseo" },
  Maritime:             { slug: "suny-maritime", name: "SUNY Maritime College" },
  Morrisville:          { slug: "suny-morrisville", name: "SUNY Morrisville" },
  "New Paltz":          { slug: "suny-new-paltz", name: "SUNY New Paltz" },
  "Old Westbury":       { slug: "suny-old-westbury", name: "SUNY Old Westbury" },
  Oneonta:              { slug: "suny-oneonta", name: "SUNY Oneonta" },
  Oswego:               { slug: "suny-oswego", name: "SUNY Oswego" },
  Plattsburgh:          { slug: "suny-plattsburgh", name: "SUNY Plattsburgh" },
  Potsdam:              { slug: "suny-potsdam", name: "SUNY Potsdam" },
  Purchase:             { slug: "suny-purchase", name: "Purchase College" },
  "Stony Brook":        { slug: "suny-stony-brook", name: "Stony Brook University" },
  "SUNY Polytechnic":   { slug: "suny-polytechnic", name: "SUNY Polytechnic Institute" },
  "University at Buffalo": { slug: "suny-buffalo", name: "University at Buffalo" },
  "Upstate Medical":    { slug: "suny-upstate", name: "SUNY Upstate Medical University" },
};

// CC campus names as they appear in the results table — used to filter OUT
// CC-to-CC mappings (we only want CC→4yr).
const CC_NAMES = new Set(Object.values(SOURCE_CCS).map((c) => c.name));

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

async function retryFetch(url: string, label: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status} for ${label}`);
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseSubjects(html: string): string[] {
  const $ = cheerio.load(html);
  const subjects: string[] = [];
  $("select#sub option").each((_, el) => {
    const val = $(el).attr("value");
    if (val) subjects.push(val);
  });
  return subjects;
}

function parseCourseNumbers(html: string): string[] {
  const $ = cheerio.load(html);
  const nums: string[] = [];
  $("select#num option").each((_, el) => {
    const val = $(el).attr("value");
    if (val) nums.push(val);
  });
  return nums;
}

function parseResultsTable(html: string): Array<{
  campus: string;
  equivCourse: string;
  equivTitle: string;
  distance: string;
  ge: boolean;
}> {
  const $ = cheerio.load(html);
  const rows: Array<{
    campus: string;
    equivCourse: string;
    equivTitle: string;
    distance: string;
    ge: boolean;
  }> = [];

  $("table#tableresults tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 4) return;

    // Cell layout: [logo, campus name, equiv course+link+GE, title, distance, comments, catalog date]
    const campus = $(cells[1]).text().trim();
    const equivCell = $(cells[2]);
    const ge = equivCell.find(".snybadge").length > 0;
    const rawCourse = equivCell.find("a").text().trim() || equivCell.text().replace(/GE/g, "").trim();
    const equivCourse = rawCourse.replace(/\s+/g, " ");
    const equivTitle = $(cells[3]).text().trim();
    const distance = $(cells[4]).text().trim();

    if (campus) {
      rows.push({ campus, equivCourse, equivTitle, distance, ge });
    }
  });

  return rows;
}

function classifyEquiv(course: string, title: string): { noCredit: boolean; isElective: boolean } {
  const cu = course.toUpperCase();
  const tu = title.toUpperCase();

  const noCredit =
    tu.includes("NO CREDIT") ||
    tu.includes("NOT TRANSFERABLE") ||
    cu === "NC" ||
    cu.includes("NO CR");

  const isElective =
    !noCredit &&
    (/XX/.test(cu) ||
      tu.includes("ELECTIVE") ||
      cu.includes("ELEC") ||
      cu.includes("TRA") && !cu.includes("TRANS") ||
      /\b[A-Z]+\s+\d?999\b/.test(cu));

  return { noCredit, isElective };
}

// ---------------------------------------------------------------------------
// Concurrency primitive
// ---------------------------------------------------------------------------

async function pmap<T, R>(items: T[], n: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Per-CC scrape
// ---------------------------------------------------------------------------

async function scrapeCC(
  slug: string,
  info: { instId: string; name: string },
): Promise<TransferMapping[]> {
  console.log(`\n=== ${info.name} (${info.instId}) ===`);

  // Level 1: get subject codes
  const subHtml = await retryFetch(
    `${BASE}/transfer-out/?inst=${info.instId}`,
    `subjects(${slug})`,
  );
  const subjects = parseSubjects(subHtml);
  console.log(`  ${subjects.length} subjects`);

  if (subjects.length === 0) return [];

  // Level 2: for each subject, get course numbers
  const coursesToScrape: Array<{ sub: string; num: string }> = [];
  for (const sub of subjects) {
    try {
      const numHtml = await retryFetch(
        `${BASE}/transfer-out/?inst=${info.instId}&sub=${encodeURIComponent(sub)}`,
        `courses(${slug}/${sub})`,
      );
      const nums = parseCourseNumbers(numHtml);
      for (const num of nums) coursesToScrape.push({ sub, num });
    } catch (e) {
      console.error(`  WARN: failed subjects/${sub}: ${e}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`  ${coursesToScrape.length} courses to query`);

  if (coursesToScrape.length === 0) return [];

  // Level 3: for each course, get the equivalency results
  const mappings: TransferMapping[] = [];
  let queried = 0;

  await pmap(coursesToScrape, CONCURRENCY, async ({ sub, num }, idx) => {
    let html: string;
    try {
      html = await retryFetch(
        `${BASE}/transfer-out/?inst=${info.instId}&sub=${encodeURIComponent(sub)}&num=${encodeURIComponent(num)}`,
        `result(${slug}/${sub}/${num})`,
      );
    } catch (e) {
      console.error(`  WARN: failed ${sub} ${num}: ${e}`);
      return;
    }

    const rows = parseResultsTable(html);
    for (const row of rows) {
      // Only keep 4-year destinations
      const dest = DEST_4YR[row.campus];
      if (!dest) continue; // skip CC-to-CC or unknown

      const { noCredit, isElective } = classifyEquiv(row.equivCourse, row.equivTitle);

      mappings.push({
        cc_prefix: sub,
        cc_number: num,
        cc_course: `${sub} ${num}`,
        cc_title: "",
        cc_credits: "",
        university: dest.slug,
        university_name: dest.name,
        univ_course: row.equivCourse,
        univ_title: row.equivTitle,
        univ_credits: "",
        notes: row.ge ? "SUNY General Education" : "",
        no_credit: noCredit,
        is_elective: isElective,
      });
    }

    queried++;
    if ((idx + 1) % 50 === 0 || idx + 1 === coursesToScrape.length) {
      process.stdout.write(
        `\r  progress: ${queried}/${coursesToScrape.length} courses, ${mappings.length} mappings`,
      );
    }
  });

  process.stdout.write("\n");
  console.log(`  ${slug}: ${mappings.length} mappings`);
  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ccFlag = args.indexOf("--cc");
  const noImport = args.includes("--no-import");

  let targetCCs: Array<[string, { instId: string; name: string }]>;
  if (ccFlag >= 0) {
    const slug = args[ccFlag + 1];
    if (!SOURCE_CCS[slug]) {
      console.error(`Unknown CC: ${slug}. Available: ${Object.keys(SOURCE_CCS).join(", ")}`);
      process.exit(1);
    }
    targetCCs = [[slug, SOURCE_CCS[slug]]];
  } else {
    targetCCs = Object.entries(SOURCE_CCS);
  }

  console.log(`Scraping ${targetCCs.length} SUNY CC(s) from STEP`);
  console.log(`  concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms`);

  const allMappings: TransferMapping[] = [];
  const start = Date.now();

  for (const [slug, info] of targetCCs) {
    try {
      const m = await scrapeCC(slug, info);
      allMappings.push(...m);
    } catch (e) {
      console.error(`\n  FATAL on ${slug}: ${e}`);
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`\nTotal raw mappings: ${allMappings.length} in ${elapsed}s`);

  // Dedupe by (cc_prefix, cc_number, university, univ_course)
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`After dedup: ${deduped.length} unique mappings`);

  // Stats by university
  const byUni = new Map<string, number>();
  for (const m of deduped) byUni.set(m.university, (byUni.get(m.university) || 0) + 1);
  console.log("\nBy university:");
  for (const [u, c] of [...byUni.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${u.padEnd(30)} ${c}`);
  }

  // Stats by type
  const direct = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const elect = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCr = deduped.filter((m) => m.no_credit).length;
  console.log("\nBy type:");
  console.log(`  direct:    ${direct}`);
  console.log(`  elective:  ${elect}`);
  console.log(`  no-credit: ${noCr}`);

  // Merge with existing CUNY data — keep all non-SUNY rows, replace SUNY rows
  const outPath = path.join(process.cwd(), "data", "ny", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {}
    // Keep CUNY data (anything without a suny- slug)
    existing = existing.filter((m) => !m.university.startsWith("suny-"));
  }

  const merged = [...existing, ...deduped];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nWritten ${merged.length} total mappings (${existing.length} CUNY + ${deduped.length} SUNY) to ${outPath}`);

  if (!noImport) {
    try {
      const inserted = await importTransfersToSupabase("ny");
      console.log(`Imported ${inserted} rows to Supabase`);
    } catch (e) {
      console.error(`Supabase import failed: ${e}`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
