/**
 * scrape-transfer-purdue.ts — Indiana transfer equivalencies (Ivy Tech → Purdue).
 *
 * Purdue West Lafayette publishes a fully public "Transfer Credit Course
 * Equivalency Guide" (Banner self-service, no login):
 *
 *   https://selfservice.mypurdue.purdue.edu/prod/bzwtxcrd.p_select_info
 *
 * The form cascades location → state → school → subject → course via an AJAX
 * endpoint (bzwtxcrd.p_ajax), then POSTs bzwtxcrd.p_display_report to render an
 * equivalency table. Ivy Tech Community College is one statewide school
 * (FICE 003825). We enumerate its subjects, then request course_in=ALL for each
 * subject and parse the report table:
 *   [ Transfer School | Subject | Course | Title | Credits |
 *     Purdue Subject | Course | Title | Credits ]
 * A row with empty transfer columns is a continuation — the same sending course
 * awarding an additional Purdue equivalent.
 *
 * Receiving institution is recorded as "purdue" / "Purdue University". This is a
 * per-receiver companion to scrape-transfer.ts (CT.Net → USI); mergeTransferRows
 * keeps both conflict-free (ownership = sender slug + receiver slug).
 *
 * Usage:
 *   npx tsx scripts/in/scrape-transfer-purdue.ts
 *   npx tsx scripts/in/scrape-transfer-purdue.ts --no-import
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { importTransfersToSupabase } from "../lib/supabase-import.js";
import { mergeTransferRows } from "../lib/transfer-merge.js";

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

const BASE = "https://selfservice.mypurdue.purdue.edu/prod";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";
const CC_SLUG = "ivy-tech-community-college";
const SCHOOL_CODE = "003825"; // Ivy Tech Community College-IN (FICE)
const STATE = "IN";
const LOCATION = "US";
const UNIV_SLUG = "purdue";
const UNIV_NAME = "Purdue University";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&dagger;|†/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Purdue's bzwtxcrd.p_ajax returns newline-delimited options: the first line is
 * the target <select> id, each subsequent line is "Label~VALUE". Returns the
 * VALUEs (skipping placeholder/"All" rows).
 */
async function ajaxOptions(
  requestType: string,
  v1: string,
  v2: string,
  v3: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    request_type: requestType,
    request_value: v1,
    request_value2: v2,
    request_value3: v3,
    request_value4: "null",
    load_into: "x",
  });
  const resp = await fetch(`${BASE}/bzwtxcrd.p_ajax?${params}`, {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) throw new Error(`p_ajax ${requestType} HTTP ${resp.status}`);
  const lines = (await resp.text()).split("\n").slice(1); // drop element-id line
  const values: string[] = [];
  for (const line of lines) {
    const tilde = line.lastIndexOf("~");
    if (tilde === -1) continue;
    const value = line.slice(tilde + 1).trim();
    if (!value || value === "ALL") continue;
    values.push(value);
  }
  return values;
}

/** Build the full p_display_report POST body (5 rows of each field). */
function reportBody(subject: string): string {
  const rows = (name: string, first: string): [string, string][] =>
    Array.from({ length: 5 }, (_, i) => [name, i === 0 ? first : ""]);
  return new URLSearchParams([
    ...rows("location_in", LOCATION),
    ...rows("state_in", STATE),
    ...rows("school_in", SCHOOL_CODE),
    ...rows("subject_in", subject),
    ...rows("course_in", "ALL"),
    ...rows("purdue_location_in", ""),
    ...rows("purdue_state_in", ""),
    ...rows("purdue_school_in", ""),
    ...rows("purdue_subject_in", ""),
    ...rows("purdue_course_in", ""),
  ]).toString();
}

function splitNumber(raw: string): string {
  // "101 †" → "101"; keep leading alphanumeric token.
  const m = clean(raw).match(/^([0-9][0-9A-Za-z]*)/);
  return m ? m[1] : clean(raw);
}

function isElectiveCourse(purdueCourse: string, purdueTitle: string): boolean {
  const c = purdueCourse.toUpperCase();
  if (/X/.test(c.replace(/^[A-Z]+/, ""))) return true; // 1XUND, 2XUND etc.
  if (/\bUND\b|UNDIST/.test(c)) return true;
  if (/\b(elective|undistributed|general)\b/i.test(purdueTitle)) return true;
  return false;
}

async function scrapeSubject(subject: string): Promise<TransferMapping[]> {
  let html = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`${BASE}/bzwtxcrd.p_display_report`, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: reportBody(subject),
    });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (!resp.ok) throw new Error(`display_report ${subject} HTTP ${resp.status}`);
    html = await resp.text();
    break;
  }

  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];
  let last: { prefix: string; number: string; title: string; credits: string } | null = null;

  $("table.reportTable tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => clean($(td).text()))
      .get();
    if (cells.length < 8) return; // header (<th>) and short rows

    const [school, subj, course, title, credits, pSubj, pCourse, pTitle] = cells;
    const pCredits = cells[8] || "";

    // Continuation row: empty transfer columns → reuse the last sending course.
    const sending =
      school || subj || course
        ? { prefix: subj, number: splitNumber(course), title, credits }
        : last;
    if (!sending || !sending.prefix || !sending.number) return;
    last = sending;

    if (!pSubj || !pCourse) return;
    const univCourse = `${pSubj} ${clean(pCourse)}`.trim();
    // Purdue emits "<dept> NC / NO CREDIT" rows for courses that do NOT
    // transfer — record as no-credit, never a positive equivalency.
    const noCredit = /^NC$/i.test(clean(pCourse)) || /\bno credit\b|does not transfer/i.test(pTitle);

    out.push({
      state: "in",
      cc_prefix: sending.prefix.toUpperCase(),
      cc_number: sending.number,
      cc_course: `${sending.prefix.toUpperCase()} ${sending.number}`,
      cc_title: sending.title,
      cc_credits: /^\d/.test(sending.credits) ? sending.credits : "",
      university: UNIV_SLUG,
      university_name: UNIV_NAME,
      univ_course: noCredit ? "" : univCourse,
      univ_title: noCredit ? "Does not transfer" : pTitle,
      univ_credits: noCredit ? "" : /^\d/.test(pCredits) ? pCredits : "",
      notes: `[${CC_SLUG}]`,
      no_credit: noCredit,
      is_elective: noCredit ? false : isElectiveCourse(pCourse, pTitle),
    });
  });

  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("Purdue Transfer Credit Equivalency — Indiana (Ivy Tech → Purdue)\n");

  console.log("Fetching Ivy Tech subjects…");
  const subjects = await ajaxOptions("subject", SCHOOL_CODE, STATE, LOCATION);
  console.log(`  ${subjects.length} subjects\n`);
  if (subjects.length === 0) {
    console.warn("  WARN: no subjects returned; leaving existing data untouched.");
    return;
  }

  const all: TransferMapping[] = [];
  const seen = new Set<string>();
  let ok = 0;
  for (const subj of subjects) {
    try {
      const rows = await scrapeSubject(subj);
      for (const r of rows) {
        const key = `${r.cc_course}|${r.univ_course}|${r.univ_title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(r);
      }
      ok++;
      if (rows.length) console.log(`  ${subj.padEnd(8)} ${rows.length} mappings`);
    } catch (err) {
      console.error(`  ${subj}: FAILED — ${(err as Error).message}`);
    }
    await sleep(250);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Subjects scraped: ${ok}/${subjects.length}`);
  console.log(
    `  Total mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective).length}, elective=${all.filter((m) => m.is_elective).length})`,
  );

  if (ok === 0 || all.length === 0) {
    console.warn("\n  WARN: nothing scraped; leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "in", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const merged = mergeTransferRows("in", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("in");
      if (imported > 0) console.log(`Imported ${imported} rows to Supabase`);
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
