/**
 * scrape-utm.ts
 *
 * Scrapes University of Tennessee at Martin's transfer equivalency API.
 * UTM exposes a clean JSON API proxied through their PHP backend:
 *   - Schools: /_modules/api/api.php?...&stype=transfer-equivalency-schools&id=TN
 *   - Courses: /_modules/api/api.php?...&stype=transfer-equivalency-courses&id={code}
 *
 * The access token is embedded in the page JS and rotates periodically.
 * This scraper fetches the page first to extract the current token.
 *
 * Usage:
 *   npx tsx scripts/tn/transfer/scrape-utm.ts
 *   npx tsx scripts/tn/transfer/scrape-utm.ts --no-import
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../../lib/supabase-import";

const PAGE_URL =
  "https://www.utm.edu/offices-and-services/academic-records/transfer-equivalency-tables.php";
const API_BASE = "https://www.utm.edu/_modules/api/api.php";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 500;

const TBR_CODES: Record<string, string> = {
  "003998": "chattanooga-state",
  "003999": "cleveland-state",
  "003483": "columbia-state",
  "006835": "dyersburg-state",
  "004937": "jackson-state",
  "006836": "motlow-state",
  "008145": "nashville-state",
  "005378": "northeast-state",
  "12693": "pellissippi-state",
  "009914": "roane-state",
  "10439": "southwest-tn",
  "009912": "volunteer-state",
  "008863": "walters-state",
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

async function getToken(): Promise<string> {
  const res = await fetch(PAGE_URL, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const m = html.match(/access_token=([^&"]+)/);
  if (!m) throw new Error("Could not extract UTM API access_token from page");
  return m[1];
}

function parseCourse(raw: string): { prefix: string; number: string; title: string } {
  const m = raw.trim().match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.*)$/);
  if (m) return { prefix: m[1], number: m[2], title: m[3].trim() };
  const m2 = raw.trim().match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
  if (m2) return { prefix: m2[1], number: m2[2], title: "" };
  const m3 = raw.trim().match(/^([A-Z]{2,5})\s+(LD|UD)\s+(.*)$/);
  if (m3) return { prefix: m3[1], number: m3[2], title: m3[3].trim() };
  return { prefix: "", number: "", title: raw.trim() };
}

export async function scrapeUTM(): Promise<TransferMapping[]> {
  console.log("UTM Transfer Equivalency Scraper");
  console.log(`  Source: ${PAGE_URL}\n`);

  console.log("Step 1: Getting API token...");
  const token = await getToken();
  console.log(`  Token: ${token.substring(0, 15)}...`);

  console.log("Step 2: Fetching TBR community college mappings...\n");
  const allMappings: TransferMapping[] = [];

  for (const [code, slug] of Object.entries(TBR_CODES)) {
    const url = `${API_BASE}?access_token=${token}&type=registrar&stype=transfer-equivalency-courses&id=${code}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const data = await res.json() as { items: Array<{
      xfer_course: string;
      term_effective: string;
      utm_course: string;
      utm_credit_hrs: number;
    }> };

    const items = data.items || [];
    let added = 0;

    for (const item of items) {
      const cc = parseCourse(item.xfer_course);
      if (!cc.prefix || !cc.number) continue;

      const univ = parseCourse(item.utm_course);
      const univCourse =
        univ.prefix && univ.number ? `${univ.prefix} ${univ.number}` : "";

      const credits = item.utm_credit_hrs;
      const creditsStr = credits > 200 ? "0" : String(credits);

      const noCredit =
        !univ.prefix ||
        !univ.number ||
        credits === 0 ||
        univ.title.toUpperCase().includes("NO CREDIT") ||
        univ.title.toUpperCase().includes("NOT TRANSFERABLE");

      const isElective =
        univ.number === "LD" ||
        univ.number === "UD" ||
        univ.title.toUpperCase().includes("ELECTIVE") ||
        univ.prefix === "GENS" ||
        univ.prefix === "ELEC";

      allMappings.push({
        cc_prefix: cc.prefix,
        cc_number: cc.number,
        cc_course: `${cc.prefix} ${cc.number}`,
        cc_title: cc.title,
        cc_credits: "",
        university: "utm",
        university_name: "University of Tennessee at Martin",
        univ_course: noCredit ? "" : univCourse,
        univ_title: noCredit ? univ.title || "No UTM credit" : univ.title,
        univ_credits: creditsStr,
        notes: item.term_effective ? `Effective: ${item.term_effective}` : "",
        no_credit: noCredit,
        is_elective: isElective,
      });
      added++;
    }

    console.log(`  ${slug}: ${added} mappings`);
    await sleep(DELAY_MS);
  }

  // Deduplicate
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
  const mappings = await scrapeUTM();

  if (mappings.length === 0) {
    console.error("\nNo mappings found!");
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), "data", "tn", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch { /* first run */ }

  const nonUtm = existing.filter((m) => m.university !== "utm");
  const merged = [...nonUtm, ...mappings];
  merged.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university),
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} UTM mappings to ${outPath}`);
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
