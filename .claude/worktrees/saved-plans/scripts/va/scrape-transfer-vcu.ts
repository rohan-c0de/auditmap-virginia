/**
 * Scrape VCU VCCS Transfer Equivalency data from their JSON API.
 *
 * Source: https://apps.sem.vcu.edu/feeds/transfer/courses/VCCS
 *
 * Merges VCU mappings into data/transfer-equiv.json alongside existing VT data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-vcu.ts
 */

import fs from "fs";
import path from "path";

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

interface VcuEntry {
  Subject: { Code: string };
  Transfer: { CourseNumber: string; Title: string; CreditHours: string };
  VCU: { CourseNumber: string; Title: string; CreditHours: string };
}

const VCU_API = "https://apps.sem.vcu.edu/feeds/transfer/courses/VCCS";

/**
 * Parse a VCU-style course number like "ENG-111" into prefix + number.
 */
function parseCourseNumber(raw: string): { prefix: string; number: string } {
  const parts = raw.split("-");
  if (parts.length >= 2) {
    return { prefix: parts[0].trim(), number: parts.slice(1).join("-").trim() };
  }
  return { prefix: "", number: raw.trim() };
}

/**
 * Format a course number from "ENGL-101" to "ENGL 101".
 */
function formatCourse(raw: string): string {
  return raw.replace(/-/, " ").trim();
}

async function scrapeVcu(): Promise<TransferMapping[]> {
  console.log(`Fetching ${VCU_API}...`);
  const res = await fetch(VCU_API);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const entries: VcuEntry[] = await res.json();
  console.log(`Fetched ${entries.length} entries from VCU API`);

  const mappings: TransferMapping[] = [];

  for (const entry of entries) {
    const { prefix: vccsPrefix, number: vccsNumber } = parseCourseNumber(
      entry.Transfer.CourseNumber
    );

    if (!vccsPrefix) continue;

    const vcuCourseRaw = entry.VCU.CourseNumber;
    const vcuCourse = formatCourse(vcuCourseRaw);
    const vcuTitle = entry.VCU.Title;

    // Detect elective: TREL-1XX, TREL-2XX, or any XXX pattern
    const isElective =
      vcuCourseRaw.includes("XX") ||
      vcuCourseRaw.startsWith("TREL");

    // VCU doesn't seem to have "no credit" entries — everything maps to something
    // But check just in case
    const noCredit =
      vcuTitle.toUpperCase().includes("NO CREDIT") ||
      vcuTitle.toUpperCase().includes("NO VCU CREDIT");

    mappings.push({
      cc_prefix: vccsPrefix,
      cc_number: vccsNumber,
      cc_course: `${vccsPrefix} ${vccsNumber}`,
      cc_title: entry.Transfer.Title,
      cc_credits: entry.Transfer.CreditHours,
      university: "vcu",
      university_name: "Virginia Commonwealth University",
      univ_course: noCredit ? "" : vcuCourse,
      univ_title: noCredit ? "No VCU credit" : vcuTitle,
      univ_credits: noCredit ? "" : entry.VCU.CreditHours,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  }

  console.log(`Parsed ${mappings.length} VCU mappings`);
  return mappings;
}

async function main() {
  console.log("VCU Transfer Equivalency Scraper\n");

  const vcuMappings = await scrapeVcu();

  // Stats
  const directEquiv = vcuMappings.filter(
    (m) => !m.no_credit && !m.is_elective
  ).length;
  const electives = vcuMappings.filter(
    (m) => !m.no_credit && m.is_elective
  ).length;
  const noCredit = vcuMappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(vcuMappings.map((m) => m.cc_prefix));

  console.log(`\nVCU Summary:`);
  console.log(`  Total mappings: ${vcuMappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = vcuMappings.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "111"
  );
  if (eng111) {
    console.log(
      `\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`
    );
  }

  const psy200 = vcuMappings.find(
    (m) => m.cc_prefix === "PSY" && m.cc_number === "200"
  );
  if (psy200) {
    console.log(
      `  Spot check — PSY 200: → ${psy200.univ_course} (${psy200.univ_title})`
    );
  }

  // Load existing data (VT mappings) and merge
  const outPath = path.join(process.cwd(), "data", "va", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  // Remove any old VCU entries, keep VT and others
  const nonVcu = existing.filter((m) => m.university !== "vcu");
  const merged = [...nonVcu, ...vcuMappings];

  console.log(
    `Merged: ${nonVcu.length} existing (non-VCU) + ${vcuMappings.length} VCU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
