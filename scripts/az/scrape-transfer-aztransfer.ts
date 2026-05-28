/**
 * scrape-transfer-aztransfer.ts — AZ transfer equivalencies from AZTransfer's
 * Course Equivalency Guide (CEG).
 *
 * AZTransfer.com is the statewide articulation portal; the actual transfer-
 * equivalency tool is at https://aztransmac2.asu.edu/cgi-bin/WebObjects/CEG.
 * Apple WebObjects app, plain HTML, no JS, no auth. Two-step crawl:
 *
 *   1. Per college: GET /cgi-bin/WebObjects/CEG.woa/wa/DeptIndex?abbrev=<CC>
 *      → side-nav lists the subject codes that college offers as
 *      &dept=<SUBJECT> links.
 *   2. Per (college × subject):
 *      GET /cgi-bin/WebObjects/CEG.woa/wa/ByInstDept?abbrev=<CC>&dept=<SUBJECT>
 *      → HTML table with 4 columns:
 *        [CC course ("ACC 105 (3) Title"), ASU equiv, NAU equiv, UA equiv]
 *      Each university cell is one of:
 *        - a specific course code (e.g. "ACC 211")
 *        - "Elective Credit"
 *        - "Non Transferable"
 *        - a departmental-elective tag (e.g. "BASV Dept Elective")
 *
 * The output is one TransferMapping per (CC course × receiving university),
 * so each scraped row produces up to 3 records. All three destinations are
 * in-state (ASU, NAU, UA), so the in-state-only rule keeps everything.
 *
 * Throttled at 500ms between fetches to be a polite citizen of ASU's
 * 1990s-vintage WebObjects server. Full crawl runs in ~10 min.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-transfer-aztransfer.ts
 *   npx tsx scripts/az/scrape-transfer-aztransfer.ts --college CGCC  # one college
 *   npx tsx scripts/az/scrape-transfer-aztransfer.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "az";
const BASE = "https://aztransmac2.asu.edu";
const CEG_HOME = `${BASE}/cgi-bin/WebObjects/CEG`;
// ASU's CEG (Apple WebObjects, 1990s-vintage) 429s under sustained load.
// 600ms between requests + exponential-backoff retry on 429/5xx (fetchHtml)
// keeps the success rate near-100% while bringing the ~21-college × ~200-
// dept crawl to ~45 min.
const DELAY_MS = 600;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// Map AZTransfer's college abbreviations → our college_slug values. Keys
// are the literal `abbrev=` values from the CEG "SELECT YOUR COLLEGE"
// dropdown (curl-verified 2026-05-24); slugs match data/az/institutions.json.
// "Maricopa" appears in the dropdown as a district aggregate — skipped in
// favor of the per-Maricopa-college rows (CGCC, Glendale, Mesa, etc.).
const ABBREV_TO_SLUG: Record<string, string> = {
  AWC: "arizona-western-college",
  Central: "central-arizona-college",
  CGCC: "chandler-gilbert-community-college",
  Cochise: "cochise-county-community-college-district",
  Coconino: "coconino-community-college",
  Dine: "dine-college",
  Eastern: "eastern-arizona-college",
  Estrella: "estrella-mountain-community-college",
  GWC: "gateway-community-college",
  Glendale: "glendale-community-college",
  Mesa: "mesa-community-college",
  Mohave: "mohave-community-college",
  Northland: "northland-pioneer-college",
  PVCC: "paradise-valley-community-college",
  PC: "phoenix-college",
  Pima: "pima-community-college",
  RIO: "rio-salado-college",
  Scottsdale: "scottsdale-community-college",
  SMCC: "south-mountain-community-college",
  TOCC: "tohono-oodham-community-college",
  Yavapai: "yavapai-college",
};

const UNIVERSITIES: { col: number; slug: string; name: string }[] = [
  { col: 1, slug: "asu", name: "Arizona State University" },
  { col: 2, slug: "nau", name: "Northern Arizona University" },
  { col: 3, slug: "ua", name: "University of Arizona" },
];

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      // Retry 429 (rate-limit) and 5xx with exponential backoff. ASU's
      // CEG returns 429 freely; 4 attempts at 3/6/12/24s recovers most.
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(3000 * Math.pow(2, attempt));
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.text();
  } catch (e) {
    if (attempt < 4 && /timeout|network|ECONN|HTTP 429|HTTP 5/i.test(String(e))) {
      await sleep(3000 * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw e;
  }
}

/** Parse the DeptIndex page for a college → list of subject codes. */
async function discoverSubjects(abbrev: string): Promise<string[]> {
  const url = `${BASE}/cgi-bin/WebObjects/CEG.woa/wa/DeptIndex?abbrev=${encodeURIComponent(abbrev)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const subjects = new Set<string>();
  // The side nav has links like:
  //   /cgi-bin/WebObjects/CEG.woa/wa/ByInstDept?abbrev=CGCC&dept=ACC
  $('a[href*="/wa/ByInstDept?"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/dept=([^&"]+)/);
    if (m) subjects.add(decodeURIComponent(m[1]));
  });
  return Array.from(subjects).sort();
}

/** Parse a CC course cell ("ACC 105 (3) Payroll, Sales and Property Taxes"). */
function parseCcCourse(raw: string): {
  prefix: string;
  number: string;
  credits: string;
  title: string;
} | null {
  // Normalize whitespace, then match: <PREFIX> <NUMBER>(<CREDITS>) <TITLE>
  // Sometimes credits are shown as "(3)" or "(3-6)" or empty. Title may
  // contain commas and parens.
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(
    /^([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)\s*(?:\(([\d.\-]+)\))?\s*(.*)$/,
  );
  if (!m) return null;
  return {
    prefix: m[1],
    number: m[2],
    credits: m[3] || "",
    title: m[4].trim(),
  };
}

/** Interpret a university equivalency cell into structured fields. */
function parseUnivCell(raw: string): {
  univ_course: string;
  univ_title: string;
  no_credit: boolean;
  is_elective: boolean;
} {
  const text = raw.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (!text || lower === "no equivalent") {
    return { univ_course: "", univ_title: "", no_credit: true, is_elective: false };
  }
  if (lower === "non transferable" || lower === "not transferable") {
    return { univ_course: "", univ_title: text, no_credit: true, is_elective: false };
  }
  if (lower === "elective credit") {
    return { univ_course: "", univ_title: "Elective Credit", no_credit: false, is_elective: true };
  }
  // "BASV Dept Elective" / "ENG Dept Elective" / etc.
  if (/\bdept\s+elective\b/i.test(text)) {
    return { univ_course: "", univ_title: text, no_credit: false, is_elective: true };
  }
  // Specific course code: "ACC 211" or "ACC 211 & ACC 212" or "ACC 211 (3)".
  // Strip trailing "(N)" credit hints; keep the first course code.
  const code = text.match(/\b([A-Z]{2,5})\s*(\d{1,4}[A-Z]?)\b/);
  if (code) {
    return {
      univ_course: `${code[1]} ${code[2]}`,
      univ_title: text,
      no_credit: false,
      is_elective: false,
    };
  }
  // Fallback: keep raw text in title, treat as elective.
  return { univ_course: "", univ_title: text, no_credit: false, is_elective: true };
}

/** Scrape one (college × subject) page → equivalency rows. */
async function scrapeDept(
  abbrev: string,
  slug: string,
  dept: string,
): Promise<TransferMapping[]> {
  const url = `${BASE}/cgi-bin/WebObjects/CEG.woa/wa/ByInstDept?abbrev=${encodeURIComponent(abbrev)}&dept=${encodeURIComponent(dept)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const out: TransferMapping[] = [];

  // The data table has class="RESULTS" on its <th> cells. Find the first
  // table whose first header is "<CC> Course".
  type CheerioSel = ReturnType<cheerio.CheerioAPI>;
  let targetTable: CheerioSel | null = null;
  $("table").each((_, t) => {
    if (targetTable) return;
    const firstTh = $(t).find("th.RESULTS").first().text().trim();
    if (/Course$/.test(firstTh)) targetTable = $(t) as CheerioSel;
  });
  if (!targetTable) return out;
  const tableSel: CheerioSel = targetTable;

  tableSel.find("tr").each((_: number, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;
    // Course cell is td[0]; <br/> separates code-credits from title.
    // We collapse to single text and let parseCcCourse handle it.
    const ccText = $(tds[0]).text();
    const cc = parseCcCourse(ccText);
    if (!cc) return;

    for (const u of UNIVERSITIES) {
      const cell = $(tds[u.col]);
      const parsed = parseUnivCell(cell.text());
      out.push({
        state: STATE,
        cc_prefix: cc.prefix,
        cc_number: cc.number,
        cc_course: `${cc.prefix} ${cc.number}`,
        cc_title: cc.title,
        cc_credits: cc.credits,
        university: u.slug,
        university_name: u.name,
        univ_course: parsed.univ_course,
        univ_title: parsed.univ_title,
        univ_credits: "",
        notes: "",
        no_credit: parsed.no_credit,
        is_elective: parsed.is_elective,
      });
    }
  });

  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("AZ Transfer Equivalency Scraper (AZTransfer CEG)");
  console.log(`  Source: ${CEG_HOME}\n`);

  const targets = collegeFilter
    ? Object.entries(ABBREV_TO_SLUG).filter(([abbr]) => abbr === collegeFilter)
    : Object.entries(ABBREV_TO_SLUG);
  if (targets.length === 0) {
    console.error(`Unknown college: ${collegeFilter}. Known: ${Object.keys(ABBREV_TO_SLUG).join(", ")}`);
    process.exit(1);
  }

  const allMappings: TransferMapping[] = [];
  const failures: { abbrev: string; dept?: string; error: string }[] = [];

  for (const [abbrev, slug] of targets) {
    let subjects: string[];
    try {
      subjects = await discoverSubjects(abbrev);
    } catch (e) {
      console.error(`  ${abbrev}: DeptIndex FAILED — ${(e as Error).message}`);
      failures.push({ abbrev, error: `DeptIndex: ${(e as Error).message}` });
      continue;
    }
    console.log(`  ${abbrev} (${slug}): ${subjects.length} subjects`);
    await sleep(DELAY_MS);

    let collegeAdded = 0;
    for (const dept of subjects) {
      try {
        const rows = await scrapeDept(abbrev, slug, dept);
        if (rows.length > 0) {
          allMappings.push(...rows);
          collegeAdded += rows.length;
        }
      } catch (e) {
        failures.push({ abbrev, dept, error: (e as Error).message });
      }
      await sleep(DELAY_MS);
    }
    console.log(`    ${abbrev}: +${collegeAdded} mappings (running total: ${allMappings.length})`);
    // Per-college checkpoint so a mid-crawl crash doesn't lose hours of work.
    try {
      fs.writeFileSync(
        "/tmp/az-transfer-checkpoint.json",
        JSON.stringify({ done: abbrev, rows: allMappings.length, failures: failures.length }),
      );
      fs.writeFileSync(
        "/tmp/az-transfer-checkpoint-data.json",
        JSON.stringify(allMappings),
      );
    } catch {
      /* checkpoint write is best-effort */
    }
  }

  console.log(`\n  Total mappings: ${allMappings.length}`);
  if (failures.length > 0) {
    console.log(`  Failures: ${failures.length} (sample: ${failures.slice(0, 3).map((f) => `${f.abbrev}${f.dept ? "/" + f.dept : ""}`).join(", ")})`);
  }

  // Dedup by (cc_course, university, univ_course) — some colleges have
  // duplicate rows in their CEG tables (e.g. same course listed twice).
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < allMappings.length) {
    console.log(`  After dedup: ${deduped.length} (dropped ${allMappings.length - deduped.length} duplicates)`);
  }

  // Sort for stable diffs.
  deduped.sort((a, b) =>
    (a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university)),
  );

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\n  Wrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && deduped.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`  Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
