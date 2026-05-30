/**
 * scrape-transfer-wcsu.ts
 *
 * Scrapes Western Connecticut State University's transfer course equivalency
 * tool at webapp.wcsu.edu/transfer/ to extract CT State CC -> WCSU mappings.
 *
 * WCSU uses a Java webapp with path-encoded jsessionid. The flow is:
 *   1. GET /transfer/ → follow redirect to get jsessionid
 *   2. GET /transfer/institutions;jsessionid={ID} → establish session
 *   3. POST /transfer/list;jsessionid={ID} with institutionCode=9268
 *      → returns HTML table with all equivalencies
 *
 * The results table (#coursesTable) has 4 columns:
 *   CC Course (PREFIX NUMBER Title) | CC Credits | WCSU Course | WCSU Credits
 *
 * Usage:
 *   npx tsx scripts/ct/scrape-transfer-wcsu.ts
 *   npx tsx scripts/ct/scrape-transfer-wcsu.ts --no-import
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

const BASE_URL = "https://webapp.wcsu.edu/transfer/";
const CT_STATE_CODE = "9268";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function parseCourseCell(text: string): {
  prefix: string;
  number: string;
  title: string;
} {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const m = trimmed.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.*)$/);
  if (m) return { prefix: m[1], number: m[2], title: m[3].trim() };

  const m2 = trimmed.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
  if (m2) return { prefix: m2[1], number: m2[2], title: "" };

  return { prefix: "", number: "", title: trimmed };
}

async function getSessionId(): Promise<string> {
  const res = await fetch(BASE_URL, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  const finalUrl = res.url;
  const m = finalUrl.match(/;jsessionid=([^?&/]+)/);
  if (!m) throw new Error(`No jsessionid in redirect URL: ${finalUrl}`);
  return m[1];
}

async function fetchEquivalencies(sessionId: string): Promise<string> {
  await fetch(`${BASE_URL}institutions;jsessionid=${sessionId}`, {
    headers: { "User-Agent": UA },
  });

  const res = await fetch(`${BASE_URL}list;jsessionid=${sessionId}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `institutionCode=${CT_STATE_CODE}`,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from WCSU`);
  return res.text();
}

function parseTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("#coursesTable tbody tr").each((_idx, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const ccCell = $(cells[0]).text().trim();
    const ccCredits = $(cells[1]).text().trim();
    const wcsuCell = $(cells[2]).text().trim();
    const wcsuCredits = $(cells[3]).text().trim();

    const cc = parseCourseCell(ccCell);
    if (!cc.prefix || !cc.number) return;

    const wcsu = parseCourseCell(wcsuCell);

    const univCourse =
      wcsu.prefix && wcsu.number ? `${wcsu.prefix} ${wcsu.number}` : "";

    const noCredit =
      !wcsu.prefix ||
      !wcsu.number ||
      wcsuCredits === "0" ||
      wcsu.title.toUpperCase().includes("NOT ACCEPTABLE") ||
      wcsu.title.toUpperCase().includes("NO CREDIT") ||
      wcsu.title.toUpperCase().includes("NOT TRANSFERABLE");

    const isElective =
      wcsu.number === "000" ||
      wcsu.number === "0000" ||
      wcsu.title.toUpperCase().includes("ELECTIVE") ||
      wcsu.prefix === "ELEC" ||
      wcsu.prefix === "REG";

    mappings.push({
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: cc.title,
      cc_credits: ccCredits,
      university: "wcsu",
      university_name: "Western Connecticut State University",
      univ_course: noCredit ? "" : univCourse,
      univ_title: noCredit ? wcsu.title || "No WCSU credit" : wcsu.title,
      univ_credits: wcsuCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

export async function scrapeWCSU(): Promise<TransferMapping[]> {
  console.log("WCSU Transfer Equivalency Scraper");
  console.log(`  Source: ${BASE_URL}`);
  console.log(`  Institution: CT State Community College (code ${CT_STATE_CODE})\n`);

  console.log("Step 1: Getting session...");
  const sessionId = await getSessionId();
  console.log(`  Session: ${sessionId.substring(0, 20)}...`);

  console.log("Step 2: Fetching equivalencies...");
  const html = await fetchEquivalencies(sessionId);
  console.log(`  Response: ${html.length} chars`);

  console.log("Step 3: Parsing table...");
  const mappings = parseTable(html);

  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of mappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  const directEquiv = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log(`\n  Total raw: ${mappings.length}`);
  console.log(`  After dedup: ${deduped.length}`);
  console.log("\n  Summary:");
  console.log(`    Direct equivalencies: ${directEquiv}`);
  console.log(`    Elective credit: ${electives}`);
  console.log(`    No credit: ${noCreditCount}`);
  console.log(`    Subject prefixes: ${prefixes.size}`);

  const eng = deduped.find((m) => m.cc_prefix === "ENG" && m.cc_number === "1010");
  if (eng) console.log(`\n  Spot check — ENG 1010: -> ${eng.univ_course} (${eng.univ_title})`);

  return deduped;
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  const mappings = await scrapeWCSU();
  if (mappings.length === 0) {
    console.error("\nNo mappings found! Check if the WCSU form changed.");
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), "data", "ct", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch { /* first run */ }

  const nonWcsu = existing.filter((m) => m.university !== "wcsu");
  const merged = [...nonWcsu, ...mappings];
  merged.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university),
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} WCSU mappings to ${outPath}`);
  console.log(`  Total in file (all universities): ${merged.length}`);

  if (!noImport) {
    try {
      await importTransfersToSupabase("ct");
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
