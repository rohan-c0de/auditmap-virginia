/**
 * scrape-utk.ts
 *
 * Scrapes University of Tennessee Knoxville's public transfer course
 * equivalency tool at bannerssb.utk.edu to extract CC → UTK mappings
 * for all 13 TBR community colleges.
 *
 * UTK's tool is a classic Banner 8 server-rendered HTML form with a
 * two-step flow:
 *   1. POST state="TN" → institution dropdown (63 TN institutions)
 *   2. POST state="TN" + inst=<code> → full equivalency table
 *      (one giant HTML table, no server-side pagination)
 *
 * No auth, cookies, or CSRF tokens required. The response is a single
 * <table id="table1"> with 5 columns:
 *   Group No | Sending Course(s) | Effective Term | UT Equivalent | Gen Ed
 *
 * Usage:
 *   npx tsx scripts/tn/transfer/scrape-utk.ts
 *   npx tsx scripts/tn/transfer/scrape-utk.ts --no-import    # skip Supabase
 *   npx tsx scripts/tn/transfer/scrape-utk.ts --inst=000319   # single institution test
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../../lib/supabase-import";

const BASE = "https://bannerssb.utk.edu/kbanpr";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The 13 TBR community colleges and their UTK Banner codes.
// These are opaque Banner IDs (not IPEDS), confirmed via the
// institution dropdown at utk_trans_course_eqv.P_Inst with state=TN.
// Roane State is included here (even though it's excluded from the
// Banner SSB course scraper) because it's still a valid TBR CC for
// transfer purposes.
const TBR_COLLEGES: Record<string, string> = {
  "000319": "Pellissippi State Community College",
  "001084": "Chattanooga State Community College",
  "002848": "Cleveland State Community College",
  "001081": "Columbia State Community College",
  "007323": "Dyersburg State Community College",
  "002266": "Jackson State Community College",
  "001543": "Motlow State Community College",
  "000850": "Nashville State Community College",
  "000453": "Northeast State Community College",
  "001656": "Roane State Community College",
  "000274": "Southwest Tennessee Community College",
  "001881": "Volunteer State Community College",
  "001893": "Walters State Community College",
};

// Delay between institution requests to avoid stressing the server.
// Each request generates a ~600 KB response server-side.
const DELAY_MS = 1500;

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
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the institution dropdown from the P_Inst response.
 * Returns an array of { code, name } pairs.
 */
function parseInstitutionList(
  html: string,
): Array<{ code: string; name: string }> {
  const $ = cheerio.load(html);
  const institutions: Array<{ code: string; name: string }> = [];
  $('select[name="Select_inst"] option').each((_, el) => {
    const code = $(el).attr("value")?.trim() || "";
    const name = $(el).text().trim();
    if (code && name && code !== "") {
      institutions.push({ code, name });
    }
  });
  return institutions;
}

/**
 * Parse the equivalency table from p_display_report response.
 *
 * Table structure (5 columns):
 *   0: Group No (numeric, groups bundled courses)
 *   1: Sending Transfer Course(s) — may contain <br> for multi-course bundles
 *   2: Effective Term — "Fall 2016 - Present" etc.
 *   3: UT Equivalent Course(s) — uses red <span> for "and" separators
 *   4: UT Gen Ed Requirements — "WC" / "OC" / "NS" etc., or &nbsp;
 *
 * Sending column format: "ENGL 1010 Composition I" (prefix number title)
 * UT column format: "ENGL 101 English Composition" or
 *   "<span...> </span> CLAS 273 Medical Terminology <span...> and</span> CLAS LD ..."
 */
function parseEquivalencyTable(
  html: string,
): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find the main data table
  const table = $("table#table1, table.pretty").first();
  if (!table.length) return mappings;

  table.find("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return; // header or separator

    const groupNo = $(cells[0]).text().trim();
    const sendingHtml = $(cells[1]).html() || "";
    const effectiveTerm = $(cells[2]).text().trim();
    const utHtml = $(cells[3]).html() || "";
    const genEd = cells.length >= 5 ? $(cells[4]).text().trim() : "";

    // Most rows have an empty group number (standalone courses). Only
    // multi-course bundles (e.g. "ADMN 1306 + ADMN 2325 → CLAS 273")
    // have a numeric group. Skip only if the sending column is empty
    // (header / separator row).
    const sendingText = $(cells[1]).text().trim();
    if (!sendingText) return;

    // Parse sending courses (split on <br>)
    const sendingCourses = parseSendingCourses(sendingHtml);
    if (sendingCourses.length === 0) return;

    // Parse UT equivalent courses (split on red "and" spans)
    const utCourses = parseUtCourses(utHtml);

    // Build the combined UT equivalent string for the mapping
    const utCombined = utCourses
      .map((c) => `${c.code} ${c.title}`.trim())
      .join(" + ");
    const utCombinedCode = utCourses.map((c) => c.code).join(" + ");

    // Detect no-credit / elective
    const noCredit =
      utCombined.toUpperCase().includes("NO CREDIT") ||
      utCombined.toUpperCase().includes("NOT TRANSFERABLE") ||
      utCourses.length === 0;
    const isElective = utCourses.some(
      (c) => c.code.includes("LD") || c.code.includes("ELEC"),
    );

    // Build notes from effective term + gen-ed
    const notesParts: string[] = [];
    if (effectiveTerm && effectiveTerm !== "&nbsp" && effectiveTerm !== "&nbsp;") {
      notesParts.push(effectiveTerm);
    }
    const cleanGenEd = genEd.replace(/&nbsp;?/g, "").trim();
    if (cleanGenEd) {
      notesParts.push(`Gen Ed: ${cleanGenEd}`);
    }
    if (sendingCourses.length > 1 && groupNo) {
      notesParts.push(
        `Bundle (group ${groupNo}): ${sendingCourses.map((c) => c.code).join(" + ")}`,
      );
    }
    const notes = notesParts.join("; ");

    // Emit one row per sending course (each maps to the same UT equivalent)
    for (const sending of sendingCourses) {
      mappings.push({
        cc_prefix: sending.prefix,
        cc_number: sending.number,
        cc_course: sending.code,
        cc_title: sending.title,
        cc_credits: "",
        university: "utk",
        university_name: "University of Tennessee Knoxville",
        univ_course: noCredit ? "" : utCombinedCode,
        univ_title: noCredit ? "No UT credit" : utCombined,
        univ_credits: "",
        notes,
        no_credit: noCredit,
        is_elective: isElective,
      });
    }
  });

  return mappings;
}

/**
 * Parse sending courses from the HTML of the "Sending Transfer Course(s)"
 * cell. Courses are separated by <br> tags. Each looks like:
 *   "ENGL 1010 Composition I"
 */
function parseSendingCourses(
  html: string,
): Array<{ prefix: string; number: string; code: string; title: string }> {
  const courses: Array<{
    prefix: string;
    number: string;
    code: string;
    title: string;
  }> = [];

  // Split on <br> tags
  const parts = html
    .split(/<br\s*\/?>/gi)
    .map((p) => p.replace(/<[^>]+>/g, "").replace(/&nbsp;?/g, " ").trim())
    .filter(Boolean);

  for (const part of parts) {
    // Match: PREFIX NUMBER Title... (e.g., "ENGL 1010 Composition I")
    const m = part.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.*)/);
    if (m) {
      courses.push({
        prefix: m[1],
        number: m[2],
        code: `${m[1]} ${m[2]}`,
        title: m[3].trim(),
      });
    } else {
      // Try without title (some rows have "ENGL 1010" only)
      const m2 = part.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*$/);
      if (m2) {
        courses.push({
          prefix: m2[1],
          number: m2[2],
          code: `${m2[1]} ${m2[2]}`,
          title: "",
        });
      }
    }
  }

  return courses;
}

/**
 * Parse UT equivalent courses from the HTML of the "UT Equivalent Course(s)"
 * cell. UTK uses inline red <span> elements with the word "and" to separate
 * multiple courses. The broken CSS (`"#FF0000";font-weight`) is fine for
 * cheerio parsing.
 *
 * Example HTML:
 *   <span style="color:#FF0000";font-weight:bolder;> </span>
 *   CLAS 273 Medical Terminology (cont)
 *   <span style="color:#FF0000";font-weight:bolder;> and</span>
 *   CLAS LD Medical Terminology (cont 273)
 */
function parseUtCourses(
  html: string,
): Array<{ code: string; title: string }> {
  const courses: Array<{ code: string; title: string }> = [];

  // Remove spans and split on " and " (which the red spans rendered)
  let clean = html
    .replace(/<span[^>]*>([^<]*)<\/span>/gi, (_, text) => {
      const t = text.trim();
      return t.toLowerCase() === "and" ? " |AND| " : " ";
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  // Split on our marker
  const parts = clean.split(/\s*\|AND\|\s*/).filter(Boolean);

  for (const part of parts) {
    const trimmed = part.trim();
    // Match "PREFIX NUMBER Title..." or "PREFIX LD Title..."
    const m = trimmed.match(
      /^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?|LD|UD)\s*(.*)/,
    );
    if (m) {
      courses.push({
        code: `${m[1]} ${m[2]}`,
        title: m[3].trim(),
      });
    } else {
      // Might be a bare "No Credit" or similar
      if (trimmed && !/^\s*$/.test(trimmed)) {
        courses.push({ code: trimmed, title: trimmed });
      }
    }
  }

  return courses;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const instArg = args.find((a) => a.startsWith("--inst="))?.split("=")[1];
  const noImport = args.includes("--no-import");

  console.log("UTK Transfer Course Equivalency Scraper");
  console.log(`  Source: ${BASE}/utk_trans_course_eqv.P_State_Inst\n`);

  // --- Step 1: get TN institution list ---
  console.log("[1/2] Fetching Tennessee institution list...");
  const instHtml = await retryFetch(
    `${BASE}/utk_trans_course_eqv.P_Inst`,
    "institution-list",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Select_state=TN",
    },
  );
  const allInstitutions = parseInstitutionList(instHtml);
  console.log(`  Found ${allInstitutions.length} Tennessee institutions`);

  // Filter to TBR community colleges (or a single --inst override)
  let targets: Array<{ code: string; name: string }>;
  if (instArg) {
    const inst = allInstitutions.find((i) => i.code === instArg);
    if (!inst) {
      console.error(`  Institution ${instArg} not found in list`);
      process.exit(1);
    }
    targets = [inst];
  } else {
    // Match TBR CCs by code
    targets = allInstitutions.filter((i) => i.code in TBR_COLLEGES);
    console.log(`  Filtered to ${targets.length} TBR community colleges:`);
    for (const t of targets) {
      console.log(`    ${t.code} — ${t.name}`);
    }
  }

  // --- Step 2: fetch equivalencies per institution ---
  console.log(`\n[2/2] Fetching equivalencies for ${targets.length} colleges...`);
  const allMappings: TransferMapping[] = [];
  let totalRows = 0;

  for (const inst of targets) {
    console.log(`\n  ${inst.name} (${inst.code})...`);
    const html = await retryFetch(
      `${BASE}/utk_trans_course_eqv.p_display_report`,
      `equiv(${inst.code})`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `Select_state=TN&Select_inst=${inst.code}`,
      },
    );

    if (!html) {
      console.log(`    Empty response, skipping`);
      continue;
    }

    const mappings = parseEquivalencyTable(html);
    console.log(`    ${mappings.length} mappings`);
    allMappings.push(...mappings);
    totalRows += mappings.length;

    if (targets.length > 1) await sleep(DELAY_MS);
  }

  console.log(`\n  Total raw mappings: ${totalRows}`);

  // --- Deduplicate across colleges ---
  // TBR common course numbering means most courses appear identically
  // across multiple CCs. Dedupe by (cc_prefix, cc_number, univ_course).
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // --- Stats ---
  const directEquiv = deduped.filter(
    (m) => !m.no_credit && !m.is_elective,
  ).length;
  const electives = deduped.filter(
    (m) => !m.no_credit && m.is_elective,
  ).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log("\nSummary:");
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject prefixes: ${prefixes.size}`);

  // --- Spot checks ---
  const engl1010 = deduped.find(
    (m) => m.cc_prefix === "ENGL" && m.cc_number === "1010",
  );
  if (engl1010) {
    console.log(
      `\n  Spot check — ENGL 1010: → ${engl1010.univ_course} (${engl1010.univ_title})`,
    );
  }
  const math1530 = deduped.find(
    (m) => m.cc_prefix === "MATH" && m.cc_number === "1530",
  );
  if (math1530) {
    console.log(
      `  Spot check — MATH 1530: → ${math1530.univ_course} (${math1530.univ_title})`,
    );
  }

  // --- Write ---
  const outDir = path.join(process.cwd(), "data", "tn");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  // Merge with existing data from other universities (APSU, MTSU, etc.)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }
  const nonUtk = existing.filter((m) => m.university !== "utk");
  const merged = [...nonUtk, ...deduped];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\n✓ Wrote ${deduped.length} UTK mappings to ${outPath}`);
  console.log(`  Total in file (all universities): ${merged.length}`);

  // --- Supabase import ---
  if (!noImport) {
    await importTransfersToSupabase("tn");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
