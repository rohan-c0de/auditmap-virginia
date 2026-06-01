/**
 * Scrape Virginia State University VCCS Transfer Equivalency data.
 *
 * Source: Static JSON at vsu.edu, served from an Angular transfer equivalency app.
 * URL: https://www.vsu.edu/files/json/transfer_equivalency/va_courselist.json
 *
 * The JSON is UTF-16 encoded. Contains ~7,466 entries for all VA institutions,
 * of which ~745 are VCCS courses (schoolcode "9999").
 *
 * Each entry:
 *   { schoolcode, coursesubject, coursenumber, coursetitle, coursehours,
 *     vsucoursesubject, vsucoursenumber, vsucoursetitle, vsucoursehours }
 *
 * vsucoursesubject "TRAN" indicates transfer elective credit (not a direct equivalency).
 *
 * Merges VSU mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-vsu.ts
 */

import fs from "fs";
import path from "path";

interface VsuEntry {
  schoolstate: string;
  schoolcode: string;
  coursesubject: string;
  coursenumber: string;
  coursetitle: string;
  coursehours: number;
  vsucoursesubject: string;
  vsucoursenumber: string;
  vsucoursetitle: string;
  vsucoursehours: number;
}

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

const VCCS_SCHOOL_CODE = "9999";
const DATA_URL =
  "https://www.vsu.edu/files/json/transfer_equivalency/va_courselist.json";

async function fetchVsuData(): Promise<VsuEntry[]> {
  console.log("Fetching VSU transfer equivalency JSON...");
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // The file is UTF-16 encoded — read as ArrayBuffer and decode
  const buf = await res.arrayBuffer();

  // Try UTF-16 LE with BOM first, then plain UTF-8
  let text: string;
  const bytes = new Uint8Array(buf);

  // Check for UTF-16 BOM (FF FE = little-endian, FE FF = big-endian)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    // UTF-16 LE with BOM
    const decoder = new TextDecoder("utf-16le");
    text = decoder.decode(buf);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16 BE with BOM
    const decoder = new TextDecoder("utf-16be");
    text = decoder.decode(buf);
  } else {
    // Try UTF-8
    text = new TextDecoder("utf-8").decode(buf);
  }

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const data = JSON.parse(text) as VsuEntry[];
  console.log(`  Loaded ${data.length} total entries`);
  return data;
}

function transformToMappings(entries: VsuEntry[]): TransferMapping[] {
  // Filter to VCCS courses only
  const vccsEntries = entries.filter((e) => e.schoolcode === VCCS_SCHOOL_CODE);
  console.log(`  VCCS entries (code ${VCCS_SCHOOL_CODE}): ${vccsEntries.length}`);

  return vccsEntries
    .map((e) => {
      const prefix = e.coursesubject.trim().toUpperCase();
      const number = e.coursenumber.trim();

      // Skip entries with no valid prefix/number
      if (!prefix || !number) return null;

      const isElective = e.vsucoursesubject === "TRAN";
      const noCredit = e.vsucoursehours === 0 && !e.vsucoursetitle;

      const univCourse = isElective
        ? `TRAN ${e.vsucoursenumber}`
        : `${e.vsucoursesubject} ${e.vsucoursenumber}`;

      return {
        cc_prefix: prefix,
        cc_number: number,
        cc_course: `${prefix} ${number}`,
        cc_title: e.coursetitle || "",
        cc_credits: String(e.coursehours),
        university: "vsu",
        university_name: "Virginia State University",
        univ_course: noCredit ? "" : univCourse,
        univ_title: noCredit
          ? "No VSU credit"
          : e.vsucoursetitle || univCourse,
        univ_credits: noCredit ? "" : String(e.vsucoursehours),
        notes: "",
        no_credit: noCredit,
        is_elective: isElective,
      } as TransferMapping;
    })
    .filter((m): m is TransferMapping => m !== null);
}

async function main() {
  console.log("VSU Transfer Equivalency Scraper\n");

  const allData = await fetchVsuData();
  const mappings = transformToMappings(allData);

  if (mappings.length === 0) {
    console.log("⚠ No VCCS mappings found! Check if the data structure changed.");
    process.exit(1);
  }

  // Stats
  const directEquiv = mappings.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = mappings.filter((m) => !m.no_credit && m.is_elective).length;
  const noCredit = mappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(mappings.map((m) => m.cc_prefix));

  console.log(`\nVSU Summary:`);
  console.log(`  Total mappings: ${mappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = mappings.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "111"
  );
  if (eng111) {
    console.log(
      `\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`
    );
  }
  const bio101 = mappings.find(
    (m) => m.cc_prefix === "BIO" && m.cc_number === "101"
  );
  if (bio101) {
    console.log(
      `  Spot check — BIO 101: → ${bio101.univ_course} (${bio101.univ_title})`
    );
  }
  const psy200 = mappings.find(
    (m) => m.cc_prefix === "PSY" && m.cc_number === "200"
  );
  if (psy200) {
    console.log(
      `  Spot check — PSY 200: → ${psy200.univ_course} (${psy200.univ_title})`
    );
  }

  // Merge with existing data
  const outPath = path.join(process.cwd(), "data", "va", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  const nonVsu = existing.filter((m) => m.university !== "vsu");
  const merged = [...nonVsu, ...mappings];

  console.log(
    `Merged: ${nonVsu.length} existing (non-VSU) + ${mappings.length} VSU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
