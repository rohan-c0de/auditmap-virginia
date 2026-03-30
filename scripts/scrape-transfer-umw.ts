/**
 * Scrape University of Mary Washington VCCS Transfer Equivalency data.
 *
 * Source: Static HTML tables at academics.umw.edu, one page per subject.
 * ~67 subject pages with table columns:
 *   VCCS Number | VCCS Course Title | UMW Credit | UMW BA/BS Equivalent | UMW BLS Equivalent | Gen-Ed Requirement
 *
 * Merges UMW mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-umw.ts
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

interface TransferMapping {
  vccs_prefix: string;
  vccs_number: string;
  vccs_course: string;
  vccs_title: string;
  vccs_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

// Subject slug → URL (some have non-standard slugs)
const SUBJECT_URLS: Record<string, string> = {
  ACC: "acc", ADJ: "adj", ARA: "ara", ARC: "arc", ART: "art",
  ASL: "asl", BCS: "bcs", BIO: "bio", BUS: "business", CHD: "chd",
  CHI: "chi", CHM: "chm", CON: "con", CRF: "crf", CSC: "csc",
  CST: "spdcst", DAN: "dan", DIT: "dit", ECO: "eco", EGR: "egr",
  ENG: "eng", ENV: "env", FIN: "fin", FRE: "fre", GEO: "geo",
  GER: "ger", GOL: "gol", GRE: "gre", HIN: "hin", HIS: "his",
  HIT: "hit", HLT: "hlt", HMS: "hms", HUM: "hum", ITA: "ita",
  ITD: "itd", ITE: "ite", ITN: "information-technology-networking",
  ITP: "itp", JPN: "jpn", KOR: "kor", LGL: "lgl", LTN: "ltn",
  MEN: "men", MKT: "mkt", MTH: "mth", MUS: "mus", NAS: "nas",
  PBS: "pbs", PED: "ped", PHI: "phi", PHT: "pht", PHY: "phy",
  PLS: "pls", PSY: "psy", RAD: "rad", REL: "rel", RUS: "rus",
  SDV: "sdv", SOC: "soc", SPA: "spa", SSC: "ssc", VTN: "vtn",
};

// Some subjects use different base URLs
const ALT_BASE: Record<string, string> = {
  ART: "https://academics.umw.edu/registrar/transfer-information/babs-transfer-credit-guide/transferrable-credit/virginia-community-college-system-vccs/",
  CON: "https://academics.umw.edu/registrar/transfer-information/resources-and-publications/babs-transfer-credit-guide/transferrable-credit/virginia-community-college-system-vccs/",
  KOR: "https://academics.umw.edu/registrar/transfer-information/resources-and-publications/babs-transfer-credit-guide/transferrable-credit/virginia-community-college-system-vccs/",
  SDV: "https://academics.umw.edu/registrar/transfer-information/resources-and-publications/babs-transfer-credit-guide/transferrable-credit/virginia-community-college-system-vccs/",
  BUS: "https://academics.umw.edu/registrar/transfer-information/resources-and-publications/babs-transfer-credit-guide/transferrable-credit/virginia-community-college-system-vccs/",
};

const DEFAULT_BASE =
  "https://academics.umw.edu/registrar/resources-and-publications/babs-transfer-credit-guide/transferrable-credit/virginia-community-college-system-vccs/";

function getUrl(subject: string): string {
  const slug = SUBJECT_URLS[subject];
  if (!slug) return "";
  const base = ALT_BASE[subject] || DEFAULT_BASE;
  return `${base}${slug}/`;
}

/**
 * Parse a VCCS course number like "ENG-111" into prefix + number.
 */
function parseVccsCourse(raw: string): { prefix: string; number: string } {
  const trimmed = raw.trim().replace(/\s+/g, "-");
  const match = trimmed.match(/^([A-Z]{2,4})-?(\d+\S*)$/);
  if (match) return { prefix: match[1], number: match[2] };
  // Try with space
  const match2 = raw.trim().match(/^([A-Z]{2,4})\s+(\d+\S*)$/);
  if (match2) return { prefix: match2[1], number: match2[2] };
  return { prefix: "", number: raw.trim() };
}

async function scrapeSubject(subject: string): Promise<TransferMapping[]> {
  const url = getUrl(subject);
  if (!url) return [];

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const mappings: TransferMapping[] = [];

    // Find all table rows
    $("table tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return; // Skip header rows

      const vccsNumberRaw = $(cells[0]).text().trim();
      const vccsTitle = $(cells[1]).text().trim();
      const umwCredits = $(cells[2]).text().trim();
      const umwBaBsEquiv = $(cells[3]).text().trim();
      // Column 4 is BLS equivalent, column 5 is Gen-Ed — we use BA/BS as primary
      const genEd = cells.length >= 6 ? $(cells[5]).text().trim() : "";

      if (!vccsNumberRaw || !vccsTitle) return;

      const { prefix, number } = parseVccsCourse(vccsNumberRaw);
      if (!prefix || !number) return;

      // Format UMW course: "ENGL-101, WI" → "ENGL 101"
      const umwCourse = umwBaBsEquiv
        .split(",")[0]
        .trim()
        .replace(/-/, " ");

      // Detect elective: NOTMJ pattern, or generic XX
      const isElective =
        umwBaBsEquiv.includes("NOTMJ") ||
        umwBaBsEquiv.includes("ELECT") ||
        umwBaBsEquiv.includes("XX");

      // Detect no credit
      const noCredit =
        umwBaBsEquiv.toUpperCase().includes("NO CREDIT") ||
        umwCredits === "0";

      const notes = genEd || "";

      mappings.push({
        vccs_prefix: prefix,
        vccs_number: number,
        vccs_course: `${prefix} ${number}`,
        vccs_title: vccsTitle,
        vccs_credits: umwCredits,
        university: "umw",
        university_name: "University of Mary Washington",
        univ_course: noCredit ? "" : umwCourse,
        univ_title: noCredit ? "No UMW credit" : umwBaBsEquiv,
        univ_credits: noCredit ? "" : umwCredits,
        notes,
        no_credit: noCredit,
        is_elective: isElective,
      });
    });

    return mappings;
  } catch {
    return [];
  }
}

async function main() {
  console.log("UMW Transfer Equivalency Scraper\n");

  const allMappings: TransferMapping[] = [];
  const subjects = Object.keys(SUBJECT_URLS).sort();

  for (let i = 0; i < subjects.length; i++) {
    const subj = subjects[i];
    process.stdout.write(`  [${i + 1}/${subjects.length}] ${subj}...`);
    const mappings = await scrapeSubject(subj);
    allMappings.push(...mappings);
    console.log(` ${mappings.length} mappings`);

    // Small delay to be polite
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nTotal: ${allMappings.length} UMW mappings`);

  if (allMappings.length === 0) {
    console.log("⚠ No mappings found! Check if the page structure changed.");
    process.exit(1);
  }

  // Stats
  const directEquiv = allMappings.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = allMappings.filter((m) => !m.no_credit && m.is_elective).length;
  const noCredit = allMappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(allMappings.map((m) => m.vccs_prefix));

  console.log(`\nUMW Summary:`);
  console.log(`  Total mappings: ${allMappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = allMappings.find((m) => m.vccs_prefix === "ENG" && m.vccs_number === "111");
  if (eng111) {
    console.log(`\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`);
  }
  const psy200 = allMappings.find((m) => m.vccs_prefix === "PSY" && m.vccs_number === "200");
  if (psy200) {
    console.log(`  Spot check — PSY 200: → ${psy200.univ_course} (${psy200.univ_title})`);
  }

  // Merge with existing data
  const outPath = path.join(process.cwd(), "data", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  const nonUmw = existing.filter((m) => m.university !== "umw");
  const merged = [...nonUmw, ...allMappings];

  console.log(
    `Merged: ${nonUmw.length} existing (non-UMW) + ${allMappings.length} UMW = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
