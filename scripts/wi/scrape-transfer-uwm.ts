/**
 * scrape-transfer-uwm.ts — Wisconsin (WTCS → UW-Milwaukee) transfer equivalencies.
 *
 * Wisconsin's statewide UW Transfer Information System was decommissioned in
 * 2020 (migrated to the login-gated Transferology), and the 16 Wisconsin
 * Technical College System (WTCS) colleges have NO in-state equivalencies in
 * CollegeTransfer.Net. The one comprehensive PUBLIC source is UW-Milwaukee's
 * Transfer Equivalency Database (TED), which exposes a clean JSON API:
 *
 *   GET https://web.uwm.edu/registrar/tools/ted/submitform/get/{ext_org_id}
 *
 * Returns every equivalency UW-Milwaukee has recorded for a sending institution.
 * All 16 WTCS colleges are present with stable external-org IDs (below).
 *
 * COVERAGE NOTE: this is WTCS → UW-Milwaukee only. Other UW System campuses
 * route students through Transferology (login-gated) and have no public API,
 * so the receiving institution is labeled precisely as "University of
 * Wisconsin-Milwaukee" rather than implying system-wide transfer.
 *
 * Field reference (per row):
 *   rtce_school_subject + rtce_school_crse_nbr  sending WTCS course (e.g. 101-114)
 *   rtce_descr1_frmvw                           sending course title
 *   rtce_subject_to + rtce_catalog_nbr_to       UWM equivalent (TRAN-NO = none,
 *                                               TRAN-FRE = free elective, "X" = dept credit)
 *   rtce_descr_to                               UWM course title
 *   rtce_units_minimum_to                       credits
 *   rtce_uwm_surplus_ger                        gen-ed flag (blank when none)
 *   rtce_end_dt_to                              validity end ("9999-12-31" = current)
 *
 * Usage:
 *   npx tsx scripts/wi/scrape-transfer-uwm.ts
 *   npx tsx scripts/wi/scrape-transfer-uwm.ts --no-import
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

interface TedRow {
  rtce_trnsfr_src_id?: string | null;
  rtce_descr_org?: string | null;
  rtce_school_subject?: string | null;
  rtce_school_crse_nbr?: string | null;
  rtce_descr1_frmvw?: string | null;
  rtce_subject_to?: string | null;
  rtce_catalog_nbr_to?: string | null;
  rtce_descr_to?: string | null;
  rtce_units_minimum_to?: string | null;
  rtce_uwm_surplus_ger?: string | null;
  rtce_end_dt_to?: string | null;
}

const UWM_SLUG = "uw-milwaukee";
const UWM_NAME = "University of Wisconsin-Milwaukee";

// WTCS colleges → UW-Milwaukee TED external-org IDs.
// Verified live against /registrar/tools/ted/subjects/get/{id}.
const COLLEGES: { slug: string; name: string; orgId: string }[] = [
  { slug: "blackhawk-technical-college", name: "Blackhawk Technical College", orgId: "0004951" },
  { slug: "chippewa-valley-technical-college", name: "Chippewa Valley Technical College", orgId: "0004954" },
  { slug: "fox-valley-technical-college", name: "Fox Valley Technical College", orgId: "0004957" },
  { slug: "gateway-technical-college", name: "Gateway Technical College", orgId: "0004958" },
  { slug: "lakeshore-technical-college", name: "Lakeshore Technical College", orgId: "0004959" },
  { slug: "madison-area-technical-college", name: "Madison Area Technical College", orgId: "0004960" },
  { slug: "mid-state-technical-college", name: "Mid-State Technical College", orgId: "0004962" },
  { slug: "milwaukee-area-technical-college", name: "Milwaukee Area Technical College", orgId: "0004963" },
  { slug: "moraine-park-technical-college", name: "Moraine Park Technical College", orgId: "0004965" },
  { slug: "nicolet-area-technical-college", name: "Nicolet Area Technical College", orgId: "0004967" },
  { slug: "northcentral-technical-college", name: "Northcentral Technical College", orgId: "0004968" },
  { slug: "northeast-wisconsin-technical-college", name: "Northeast Wisconsin Technical College", orgId: "0004969" },
  { slug: "southwest-wisconsin-technical-college", name: "Southwest Wisconsin Technical College", orgId: "0004970" },
  { slug: "waukesha-county-technical-college", name: "Waukesha County Technical College", orgId: "0004997" },
  { slug: "western-technical-college", name: "Western Technical College", orgId: "0004998" },
  { slug: "northwood-technical-college", name: "Northwood Technical College", orgId: "0004999" },
];

const BASE = "https://web.uwm.edu/registrar/tools/ted/submitform/get";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(s: string | null | undefined): string {
  if (!s) return "";
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();
}

async function scrapeCollege(
  cc: { slug: string; name: string; orgId: string },
): Promise<TransferMapping[]> {
  const url = `${BASE}/${cc.orgId}`;
  let rows: TedRow[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; cc-coursemap)" } });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 3000);
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    rows = (await resp.json()) as TedRow[];
    break;
  }

  const out: TransferMapping[] = [];
  const seen = new Set<string>();
  let skippedWildcard = 0;
  let skippedExpired = 0;

  for (const r of rows) {
    const sendSubject = clean(r.rtce_school_subject);
    const sendNumber = clean(r.rtce_school_crse_nbr);
    const sendTitle = clean(r.rtce_descr1_frmvw);
    // Wildcard rows ("###", "1##", "All courses not listed") are catch-all
    // bucket rules, not specific transferable courses.
    if (!sendNumber || sendNumber.includes("#") || !sendSubject) {
      skippedWildcard++;
      continue;
    }

    // Drop expired equivalencies (current rows carry end date 9999-12-31).
    const endDt = clean(r.rtce_end_dt_to);
    if (endDt && /^\d{4}-/.test(endDt) && endDt < "2026-01-01") {
      skippedExpired++;
      continue;
    }

    const recvSubject = clean(r.rtce_subject_to);
    const recvNumberRaw = clean(r.rtce_catalog_nbr_to).replace(/-+$/, "").trim();
    const recvTitle = clean(r.rtce_descr_to);
    const credits = clean(r.rtce_units_minimum_to);

    const noCredit =
      recvSubject === "TRAN-NO" || /^non-?transferable$/i.test(recvTitle) || recvSubject === "";

    // "X" catalog number or no digits = departmental/undistributed credit
    // (not a specific course); TRAN-FRE = free elective.
    const isElective =
      !noCredit &&
      (recvSubject === "TRAN-FRE" ||
        recvNumberRaw.toUpperCase() === "X" ||
        !/\d/.test(recvNumberRaw) ||
        /\b(elective|free)\b/i.test(recvTitle));

    const ger = clean(r.rtce_uwm_surplus_ger);
    let notes = `[${cc.slug}]`;
    if (ger && ger !== "") notes += ` UWM gen-ed: ${ger}`;

    const univCourse = noCredit ? "" : `${recvSubject} ${recvNumberRaw}`.trim();

    const mapping: TransferMapping = {
      state: "wi",
      cc_prefix: sendSubject,
      cc_number: sendNumber,
      cc_course: `${sendSubject}-${sendNumber}`,
      cc_title: sendTitle,
      cc_credits: "",
      university: UWM_SLUG,
      university_name: UWM_NAME,
      univ_course: univCourse,
      univ_title: noCredit ? "Does not transfer" : recvTitle,
      univ_credits: noCredit ? "" : credits,
      notes,
      no_credit: noCredit,
      is_elective: isElective,
    };

    const key = `${mapping.cc_course}|${mapping.univ_course}|${mapping.univ_title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapping);
  }

  const transferable = out.filter((m) => !m.no_credit);
  console.log(
    `  ${cc.slug.padEnd(40)} rows=${rows.length} kept=${out.length} ` +
      `(transferable=${transferable.length}, direct=${transferable.filter((m) => !m.is_elective).length}) ` +
      `wildcard=${skippedWildcard} expired=${skippedExpired}`,
  );
  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("UW-Milwaukee TED — Wisconsin (WTCS) Transfer Scraper\n");

  const successful = new Set<string>();
  const all: TransferMapping[] = [];
  for (const cc of COLLEGES) {
    try {
      const mappings = await scrapeCollege(cc);
      all.push(...mappings);
      successful.add(cc.slug);
    } catch (err) {
      console.error(`  ${cc.slug}: FAILED — ${(err as Error).message}`);
    }
    await sleep(300);
  }

  const transferable = all.filter((m) => !m.no_credit);
  console.log("\n=== Summary ===");
  console.log(`  Colleges scraped: ${successful.size}/${COLLEGES.length}`);
  console.log(`  Total mappings: ${all.length}`);
  console.log(
    `  Transferable: ${transferable.length} ` +
      `(direct=${transferable.filter((m) => !m.is_elective).length}, ` +
      `elective=${transferable.filter((m) => m.is_elective).length})`,
  );
  console.log(`  Non-transferable: ${all.length - transferable.length}`);

  if (successful.size === 0) {
    console.warn("\n  WARN: no colleges scraped; leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "wi", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const merged = mergeTransferRows("wi", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("wi");
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
