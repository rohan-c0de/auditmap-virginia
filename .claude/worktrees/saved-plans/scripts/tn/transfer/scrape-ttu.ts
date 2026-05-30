/**
 * scrape-ttu.ts
 *
 * Scrapes Tennessee Technological University's transfer equivalency tool
 * at webapps.tntech.edu. Simple HTML tables, no auth required.
 *
 * Flow: instview3.asp?form_instcode={code} → HTML table with 5 columns:
 *   Transfer Course ID | Transfer Course Name | TTU Course ID | TTU Course Name | Effective Term
 *
 * Usage:
 *   npx tsx scripts/tn/transfer/scrape-ttu.ts
 *   npx tsx scripts/tn/transfer/scrape-ttu.ts --no-import
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../../lib/supabase-import";

const BASE = "https://webapps.tntech.edu/mis/Banner_TransferEquiv";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 1000;

const TBR_COLLEGES: Record<string, string> = {
  "001084": "Chattanooga State Community College",
  "002848": "Cleveland State Community College",
  "001081": "Columbia State Community College",
  "007323": "Dyersburg State Community College",
  "002266": "Jackson State Community College",
  "001543": "Motlow State Community College",
  "000850": "Nashville State Community College",
  "000453": "Northeast State Community College",
  "000319": "Pellissippi State Community College",
  "001656": "Roane State Community College",
  "000274": "Southwest Tennessee Community College",
  "001881": "Volunteer State Community College",
  "001893": "Walters State Community College",
};

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseCourseId(raw: string): { prefix: string; number: string } {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const m = trimmed.match(/^([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)$/);
  if (m) return { prefix: m[1], number: m[2] };
  // "JOURELEC" style (no space between prefix and ELEC/LD/UD)
  const m2 = trimmed.match(/^([A-Z]{2,5})(ELEC|LD|UD)$/);
  if (m2) return { prefix: m2[1], number: m2[2] };
  return { prefix: "", number: "" };
}

function parseTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return;

    const ccId = $(cells[0]).text().trim();
    const ccTitle = $(cells[1]).text().trim();
    const ttuId = $(cells[2]).text().trim();
    const ttuTitle = $(cells[3]).text().trim();
    const effectiveTerm = $(cells[4]).text().trim();

    const cc = parseCourseId(ccId);
    if (!cc.prefix) return;

    const ttu = parseCourseId(ttuId);
    const univCourse = ttu.prefix && ttu.number ? `${ttu.prefix} ${ttu.number}` : "";

    const noCredit =
      !ttu.prefix ||
      ttuTitle.toUpperCase().includes("NO CREDIT") ||
      ttuTitle.toUpperCase().includes("NOT TRANSFERABLE") ||
      ttuTitle.toUpperCase().includes("NOT ACCEPTABLE");

    const isElective =
      ttu.number === "ELEC" ||
      ttu.number === "LD" ||
      ttu.number === "UD" ||
      ttuTitle.toUpperCase().includes("ELECTIVE");

    mappings.push({
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: ccTitle,
      cc_credits: "",
      university: "ttu",
      university_name: "Tennessee Technological University",
      univ_course: noCredit ? "" : univCourse,
      univ_title: noCredit ? ttuTitle || "No TTU credit" : ttuTitle,
      univ_credits: "",
      notes: effectiveTerm ? `Effective: ${effectiveTerm}` : "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

export async function scrapeTTU(): Promise<TransferMapping[]> {
  console.log("TTU Transfer Equivalency Scraper");
  console.log(`  Source: ${BASE}\n`);

  const allMappings: TransferMapping[] = [];

  for (const [code, name] of Object.entries(TBR_COLLEGES)) {
    const url = `${BASE}/instview3.asp?form_instcode=${code}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`  ${name}: HTTP ${res.status}`);
      continue;
    }
    const html = await res.text();
    const mappings = parseTable(html);
    console.log(`  ${name}: ${mappings.length} mappings`);
    allMappings.push(...mappings);
    await sleep(DELAY_MS);
  }

  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  const direct = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;

  console.log(`\n  Total raw: ${allMappings.length}`);
  console.log(`  After dedup: ${deduped.length}`);
  console.log(`  Direct: ${direct}, Elective: ${electives}, No credit: ${noCreditCount}`);

  return deduped;
}

async function main() {
  const noImport = process.argv.includes("--no-import");
  const mappings = await scrapeTTU();

  if (mappings.length === 0) {
    console.error("\nNo mappings found!");
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), "data", "tn", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch { /* first run */ }

  const nonTtu = existing.filter((m) => m.university !== "ttu");
  const merged = [...nonTtu, ...mappings];
  merged.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university),
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} TTU mappings to ${outPath}`);
  console.log(`  Total in file: ${merged.length}`);

  if (!noImport) {
    try {
      await importTransfersToSupabase("tn");
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
