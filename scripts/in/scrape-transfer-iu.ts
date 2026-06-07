/**
 * scrape-transfer-iu.ts — Indiana transfer equivalencies (Ivy Tech → Indiana University).
 *
 * IU Bloomington's public Credit Transfer Service (no login) is a ColdFusion app
 * backed by a JSON API:
 *
 *   https://cts.admissions.indiana.edu/transferin.cfm
 *   https://cts.admissions.indiana.edu/components.cfc?method=...&ReturnFormat=json
 *
 * Cascade (all values come back "~~"-prefixed and must be stripped):
 *   getSchools{CHOSEN_COUNTRY,CHOSEN_STATE}  → Ivy Tech EXT_ORG_ID
 *   getSubjects{EXT_ORG_ID}                   → subjects
 *   getCourses{EXT_ORG_ID,SUBJECT}            → courses
 *   getResultsIn{EXT_ORG_ID,SUBJECT,COURSE}   → equivalency rows
 *
 * getResultsIn returns a ColdFusion query {COLUMNS,DATA}. Rows carry a ROWTYPE:
 *   TF = "transfer from" (the sending Ivy Tech course)
 *   TT = "transfer to"   (the IU course awarded)
 * grouped by XFRCRDT_RULE_KEY. A rule with a single TF maps that sending course
 * to each TT; multi-TF rules are course COMBINATIONS (take A+B to get C) and are
 * skipped so we never imply a single-course equivalence that isn't real (same
 * policy as the CT.Net engine).
 *
 * Receiving institution = "indiana-university" / "Indiana University Bloomington".
 * Per-receiver companion to scrape-transfer.ts / scrape-transfer-purdue.ts;
 * mergeTransferRows keeps all three conflict-free.
 *
 * Usage:
 *   npx tsx scripts/in/scrape-transfer-iu.ts
 *   npx tsx scripts/in/scrape-transfer-iu.ts --no-import
 */

import fs from "fs";
import path from "path";
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

const CFC = "https://cts.admissions.indiana.edu/components.cfc";
const REFERER = "https://cts.admissions.indiana.edu/transferin.cfm";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CC_SLUG = "ivy-tech-community-college";
const UNIV_SLUG = "indiana-university";
const UNIV_NAME = "Indiana University Bloomington";

interface CfQuery {
  COLUMNS: string[];
  DATA: unknown[][];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const strip = (s: unknown): string => String(s ?? "").replace(/~~/g, "").trim();

function cleanStr(s: unknown): string {
  return String(s ?? "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function cfc(method: string, data: Record<string, string>): Promise<CfQuery> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`${CFC}?method=${method}&ReturnFormat=json`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: REFERER,
      },
      body: new URLSearchParams(data).toString(),
    });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (!resp.ok) throw new Error(`${method} HTTP ${resp.status}`);
    const json = JSON.parse(await resp.text());
    return { COLUMNS: json.COLUMNS || [], DATA: json.DATA || [] };
  }
  throw new Error(`${method} exhausted retries`);
}

/** "BUS-UN", "1XX", titles naming undistributed/elective credit → elective. */
function isElectiveIU(subj: string, catlg: string, title: string): boolean {
  if (/-?UN$|UNDIST/i.test(subj)) return true;
  if (/X/i.test(catlg.replace(/^[A-Za-z]+/, ""))) return true;
  if (/\b(elective|undistributed|undist|general)\b/i.test(title)) return true;
  return false;
}

async function scrapeSubject(org: string, subject: string): Promise<TransferMapping[]> {
  const courses = (await cfc("getCourses", { EXT_ORG_ID: org, SUBJECT: subject })).DATA;
  const out: TransferMapping[] = [];

  for (const c of courses) {
    const course = strip((c as unknown[])[0]);
    if (!course) continue;
    const res = await cfc("getResultsIn", {
      EXT_ORG_ID: org,
      SUBJECT: subject,
      COURSE: course,
      ADDITIONAL_SUBJECTS: "",
      ADDITIONAL_COURSES: "",
    });
    const idx = Object.fromEntries(res.COLUMNS.map((c2, i) => [c2, i]));
    const col = (row: unknown[], name: string): string => cleanStr(row[idx[name]]);

    // Group rows by rule key; collect TF (sending) and TT (IU) rows per rule.
    const rules = new Map<string, { tf: unknown[][]; tt: unknown[][] }>();
    for (const row of res.DATA) {
      const key = col(row, "XFRCRDT_RULE_KEY");
      const type = col(row, "ROWTYPE");
      if (!rules.has(key)) rules.set(key, { tf: [], tt: [] });
      if (type === "TF") rules.get(key)!.tf.push(row);
      else if (type === "TT") rules.get(key)!.tt.push(row);
    }

    for (const { tf, tt } of rules.values()) {
      if (tf.length !== 1 || tt.length === 0) continue; // skip combos & no-credit
      const sPrefix = col(tf[0], "XFRCRDT_SCH_SUBJ_CD").toUpperCase();
      const sNumber = col(tf[0], "XFRCRDT_CRS_NBR");
      const sTitle = col(tf[0], "EXT_ORG_CRS_DESC");
      if (!sPrefix || !sNumber) continue;
      for (const t of tt) {
        const tSubj = col(t, "XFRCRDT_TO_CRS_SUBJ_CD");
        const tNbr = col(t, "XFRCRDT_TO_CRS_CATLG_NBR");
        const tTitle = col(t, "XFRCRDT_TO_CRS_TTL");
        const tUnits = col(t, "XFRCRDT_UNT_TKN_NBR");
        if (!tSubj || !tNbr) continue;
        // IU emits "NTRN / TRANSFER CREDIT NOT ACCEPTED" rows for courses that
        // do NOT transfer — record as no-credit, never a positive equivalency.
        const noCredit =
          /^NTRN$/i.test(tSubj) || /not accepted|does not transfer/i.test(tTitle);
        out.push({
          state: "in",
          cc_prefix: sPrefix,
          cc_number: sNumber,
          cc_course: `${sPrefix} ${sNumber}`,
          cc_title: sTitle,
          cc_credits: "",
          university: UNIV_SLUG,
          university_name: UNIV_NAME,
          univ_course: noCredit ? "" : `${tSubj} ${tNbr}`.trim(),
          univ_title: noCredit ? "Does not transfer" : tTitle,
          univ_credits: noCredit ? "" : /^\d/.test(tUnits) ? tUnits : "",
          notes: `[${CC_SLUG}]`,
          no_credit: noCredit,
          is_elective: noCredit ? false : isElectiveIU(tSubj, tNbr, tTitle),
        });
      }
    }
    await sleep(90);
  }
  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("IU Credit Transfer Service — Indiana (Ivy Tech → Indiana University)\n");

  // Discover Ivy Tech's external-org id (don't hardcode).
  const schools = (await cfc("getSchools", { CHOSEN_COUNTRY: "USA", CHOSEN_STATE: "IN" })).DATA;
  const ivy = schools.find((s) => /ivy tech/i.test(JSON.stringify(s)));
  if (!ivy) {
    console.warn("  WARN: Ivy Tech not found in IU school list; leaving data untouched.");
    return;
  }
  const org = strip((ivy as unknown[])[0]);
  console.log(`  Ivy Tech EXT_ORG_ID = ${org}`);

  const subjects = (await cfc("getSubjects", { EXT_ORG_ID: org })).DATA
    .map((s) => strip((s as unknown[])[0]))
    .filter(Boolean);
  console.log(`  ${subjects.length} subjects\n`);
  if (subjects.length === 0) {
    console.warn("  WARN: no subjects; leaving data untouched.");
    return;
  }

  const all: TransferMapping[] = [];
  const seen = new Set<string>();
  let ok = 0;
  for (const subj of subjects) {
    try {
      const rows = await scrapeSubject(org, subj);
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
