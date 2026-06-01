/**
 * scrape-du-transfer.ts
 *
 * Scrapes course-to-course transfer equivalencies from the University of
 * Denver (DU) public Banner "Transfer Articulation" tool. No login required.
 *
 * Flow:
 *   1. GET the landing page (P_DU_Choose_Geog_Area) — discovers the state form.
 *   2. POST state_in=CO to P_DU_Choose_School — returns the institution
 *      dropdown whose <option value="…"> codes we want.
 *   3. POST sbgi_in=<code> to P_DU_Disp_Equivalencies — returns an HTML table
 *      of sending-course → DU-course pairs.
 *
 * The statewide "Colorado Community College System" code (CCCS) returns the
 * full set of CCNS-numbered course equivalencies covering every CO community
 * college, because CO uses a statewide Common Course Numbering System. We use
 * CCCS as the primary source and (optionally) merge per-college CO codes to
 * fill any gaps; rows are deduped by (cc_course, univ_course).
 *
 * Table layout (cells use CLASS="dbdefault"), 9 columns per row:
 *   [0] CCCS course   [1] CCCS title   [2] CCCS hours
 *   [3] arrow (➜)     [4] And/Or       [5] DU course
 *   [6] DU title      [7] DU hours     [8] attributes
 *
 * Output: writes nothing on its own — exports scrapeDu() consumed by
 * build-transfers.ts. Run standalone with `tsx scripts/co/scrape-du-transfer.ts`
 * to print a row count and samples for debugging.
 */

import * as cheerio from "cheerio";
import { fetchWithRetry } from "../lib/http-retry";

const BASE = "https://apps25.du.edu:8446/mdb";
const LANDING = `${BASE}/du_bwcktart.P_DU_Choose_Geog_Area`;
const SCHOOLS = `${BASE}/du_bwcktart.P_DU_Choose_School`;
const EQUIV = `${BASE}/du_bwcktart.P_DU_Disp_Equivalencies`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface TransferRow {
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

const DU_SLUG = "du";
const DU_NAME = "University of Denver";

// The statewide code returns ~329 CCNS pairs. Per-college codes are merged
// afterward to fill gaps the statewide list misses. (sbgi_in values verified
// from the live P_DU_Choose_School Colorado dropdown.)
const STATEWIDE_CODE = "CCCS";
const PER_COLLEGE_CODES = [
  "4014", // Arapahoe Community College
  "4119", // Front Range Community College
  "4130", // Red Rocks Community College
  "0969", // Community College of Aurora
  "4137", // Community College of Denver
  "4634", // Pueblo Community College
  "4204", // Aims Community College
  "0444", // Morgan Community College
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clean(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a CCNS-style course code "ACC 1021" into prefix + number. */
function splitCourse(code: string): { prefix: string; number: string } {
  const m = code.match(/^([A-Z]{2,5})\s*([0-9]{3,4}[A-Z]?)$/);
  if (m) return { prefix: m[1], number: m[2] };
  return { prefix: "", number: "" };
}

/** Is the DU receiving course an elective placeholder (e.g. COEL 1XXX)? */
function isElective(duCourse: string): boolean {
  return /\bXXX\b/i.test(duCourse) || /\bELEC\b/i.test(duCourse) || /\d\s*XXX/i.test(duCourse);
}

async function postForm(url: string, body: Record<string, string>, label: string): Promise<string> {
  const form = new URLSearchParams(body).toString();
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        Accept: "text/html",
      },
      body: form,
    },
    { label, timeoutMs: 60_000 }
  );
  return res.text();
}

/** Parse the equivalencies HTML for one institution code into transfer rows. */
function parseEquiv(html: string): TransferRow[] {
  const $ = cheerio.load(html);
  const rows: TransferRow[] = [];

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find('td[class="dbdefault"], td.dbdefault')
      .toArray()
      .map((td) => clean($(td).text()));

    // A data row has the 9-column shape with an arrow in column 3.
    if (cells.length < 8) return;
    const arrowIdx = cells.findIndex((c) => c.includes("➜") || c.includes("➜"));
    if (arrowIdx === -1) return;

    // CCCS side = cells before the arrow; DU side = cells after (skip And/Or).
    const ccCourse = clean(cells[0] || "");
    const ccTitle = clean(cells[1] || "");
    const ccCredits = clean(cells[2] || "");

    // After arrow: [arrowIdx+1]=And/Or, +2=course, +3=title, +4=hours, +5=attrs
    const duCourse = clean(cells[arrowIdx + 2] || "");
    const duTitle = clean(cells[arrowIdx + 3] || "");
    const duCredits = clean(cells[arrowIdx + 4] || "");
    const attrs = clean(cells[arrowIdx + 5] || "");

    if (!ccCourse || !duCourse) return;
    const { prefix, number } = splitCourse(ccCourse);
    if (!prefix || !number) return; // not a real course code row

    rows.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: ccCourse,
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: DU_SLUG,
      university_name: DU_NAME,
      univ_course: duCourse,
      univ_title: duTitle,
      univ_credits: duCredits,
      notes: attrs.replace(/^[-\s]+/, "").trim(),
      no_credit: false,
      is_elective: isElective(duCourse),
    });
  });

  return rows;
}

export async function scrapeDu(): Promise<TransferRow[]> {
  // 1. Prime the session (landing + schools list). Not strictly required for
  //    the POST to succeed, but it confirms the form contract and is polite.
  await fetchWithRetry(LANDING, { headers: { "User-Agent": UA } }, { label: "du-landing" }).then((r) =>
    r.text()
  );
  await postForm(SCHOOLS, { state_in: "CO", button_state: "List Schools" }, "du-schools");
  await sleep(400);

  const all: TransferRow[] = [];

  // 2. Statewide CCCS first.
  const codes = [STATEWIDE_CODE, ...PER_COLLEGE_CODES];
  for (const code of codes) {
    try {
      const html = await postForm(EQUIV, { sbgi_in: code }, `du-equiv-${code}`);
      const parsed = parseEquiv(html);
      console.log(`  DU sbgi_in=${code}: ${parsed.length} rows`);
      all.push(...parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  DU sbgi_in=${code} failed: ${msg}`);
    }
    await sleep(500);
  }

  // 3. Dedupe by (cc_course, univ_course) — per-college lists overlap heavily
  //    with the statewide list. Keep first (statewide) occurrence.
  const seen = new Set<string>();
  const deduped: TransferRow[] = [];
  for (const r of all) {
    const key = `${r.cc_course}||${r.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}

// Standalone debug entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeDu()
    .then((rows) => {
      console.log(`\nDU total deduped rows: ${rows.length}`);
      for (const r of rows.slice(0, 5)) {
        console.log(`  ${r.cc_course} (${r.cc_title}) -> ${r.univ_course} (${r.univ_title}) [${r.univ_credits}]`);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
