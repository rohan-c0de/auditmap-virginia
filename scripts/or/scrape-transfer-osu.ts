/**
 * scrape-transfer-osu.ts — Oregon CC → OSU transfer equivalencies
 *
 * Oregon State University publishes fixed-width plain-text (.inc) files
 * for every Oregon community college at:
 *   https://files.admissions.oregonstate.edu/admindb/OregonTransferCredit-
 *     OregonCollegesandUniversities/scr1160_<FICE>.inc
 *
 * The FICE code for each CC is embedded in the "Printer friendly version"
 * link on the OSU course-equivalencies page for that college.
 *
 * Format (88 chars / line):
 *   cols  0– 5  CC dept    (right-padded)
 *   cols  6–11  CC number  (right-padded)
 *   cols 12–46  CC title   (35 chars, right-padded)
 *   cols 47–51  OSU dept   (5 chars, right-padded)
 *   cols 52–57  OSU number (6 chars, right-padded)
 *   cols 58–87  OSU title  (30 chars, right-padded)
 *
 * Special OSU numbers:
 *   LDT = Lower Division Transfer (elective credit)
 *   UDT = Upper Division Transfer (elective credit)
 *   NC  = No Credit
 *
 * Coverage: 16 of 17 Oregon CCs (Oregon Coast CC not in OSU database).
 *
 * Usage:
 *   npx tsx scripts/or/scrape-transfer-osu.ts
 *   npx tsx scripts/or/scrape-transfer-osu.ts --college chemeketa-community-college
 *   npx tsx scripts/or/scrape-transfer-osu.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "or";
const OSU_SLUG = "oregon-state"; // internal university slug
const OSU_NAME = "Oregon State University";
const BASE_ADMISSIONS = "https://admissions.oregonstate.edu";

// Map our institution slugs → OSU URL slug (only where they differ)
const SLUG_OVERRIDE: Record<string, string> = {
  "southwestern-oregon-community-college": "southwestern-ore-comm-college",
  "mt-hood-community-college": "mount-hood-community-college",
};

// Oregon Coast CC is not in the OSU database — skip it
const SKIP_COLLEGES = new Set(["oregon-coast-community-college"]);

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

/** Parse one 88-char line from a .inc file */
function parseLine(line: string): TransferMapping | null {
  // Skip header, blank lines, and HTML tags
  if (!line || line.startsWith("<") || line.startsWith("     Transfer")) return null;
  if (line.trim().length === 0) return null;

  // Lines are at least 58 chars; shorter ones are malformed
  if (line.length < 52) return null;

  const ccDept   = line.slice(0, 6).trim();
  const ccNum    = line.slice(6, 12).trim();
  const ccTitle  = line.slice(12, 47).trim();
  const osuDept  = line.slice(47, 52).trim();
  const osuNum   = line.slice(52, 58).trim();
  const osuTitle = line.slice(58).trim().replace(/[+*]/g, "").trim();

  // Require cc dept to start with a letter and contain only letters/spaces
  if (!ccDept || !ccNum) return null;
  if (!/^[A-Z]/.test(ccDept) || /[^A-Z\s]/.test(ccDept)) return null;
  // Require cc number to look like a course number (digits + optional letters)
  if (!/^\d/.test(ccNum) && !/^[A-Z]/.test(ccNum)) return null;

  // Clean OSU title of core-designation prefixes (+, *, +*)
  const cleanOsuTitle = osuTitle.replace(/^[+*]+\s*/, "").replace(/^[A-Z]+:\s*/, "").trim();

  const isNC = osuNum === "NC" || /no\s*credit/i.test(osuNum + " " + osuDept);
  const isElective = !isNC && (osuNum === "LDT" || osuNum === "UDT" || osuNum === "ELEC");
  const univCourse = (!isNC && !isElective && osuDept && osuNum)
    ? `${osuDept} ${osuNum}`
    : "";

  return {
    state: STATE,
    cc_prefix: ccDept,
    cc_number: ccNum,
    cc_course: `${ccDept} ${ccNum}`,
    cc_title: ccTitle,
    cc_credits: "",
    university: OSU_SLUG,
    university_name: OSU_NAME,
    univ_course: univCourse,
    univ_title: cleanOsuTitle,
    univ_credits: "",
    notes: "",
    no_credit: isNC,
    is_elective: isElective,
  };
}

async function scrapeCollege(slug: string): Promise<TransferMapping[]> {
  const osuSlug = SLUG_OVERRIDE[slug] ?? slug;
  const pageUrl = `${BASE_ADMISSIONS}/course-equivalencies-${osuSlug}`;

  // 1. Fetch the equivalency page to find the .inc URL
  const pageRes = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)" },
  });
  if (!pageRes.ok) {
    console.warn(`  ${slug}: page fetch failed (${pageRes.status}) — skipping`);
    return [];
  }
  const html = await pageRes.text();

  // Extract .inc link: href="https://files.admissions.oregonstate.edu/.../*.inc"
  const incMatch = html.match(/href="(https:\/\/files\.admissions\.oregonstate\.edu[^"]*\.inc)"/);
  if (!incMatch) {
    console.warn(`  ${slug}: no .inc link found on ${pageUrl} — skipping`);
    return [];
  }
  const incUrl = incMatch[1];

  // 2. Fetch the .inc file
  const incRes = await fetch(incUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)" },
  });
  if (!incRes.ok) {
    console.warn(`  ${slug}: .inc fetch failed (${incRes.status}) — skipping`);
    return [];
  }
  const text = await incRes.text();

  // 3. Parse each line
  const lines = text.split("\n");
  const mappings: TransferMapping[] = [];
  for (const line of lines) {
    const m = parseLine(line);
    if (m) {
      m.cc_prefix = m.cc_prefix; // already set with slug from outer scope
      mappings.push(m);
    }
  }

  console.log(`  ${slug}: ${mappings.length} mappings (from ${incUrl.split("/").pop()})`);
  return mappings;
}

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1]
    ?? (args[args.indexOf("--college") + 1] !== undefined && !args[args.indexOf("--college") + 1].startsWith("--")
      ? args[args.indexOf("--college") + 1]
      : undefined);
  const noImport = args.includes("--no-import");

  console.log("OR Transfer Equivalency Scraper (OSU .inc files)");
  console.log(`  Source: ${BASE_ADMISSIONS}/course-equivalencies-<college>`);
  console.log(`  Receiver: ${OSU_NAME}\n`);

  // Get list of Oregon CC slugs from institutions.json
  const institutionsPath = path.join(process.cwd(), "data", STATE, "institutions.json");
  const institutions: Array<{ college_slug: string }> = JSON.parse(
    fs.readFileSync(institutionsPath, "utf-8")
  );
  let slugs = institutions
    .map((i) => i.college_slug)
    .filter((s) => !SKIP_COLLEGES.has(s));

  if (collegeFilter) {
    slugs = slugs.filter((s) => s === collegeFilter);
    if (slugs.length === 0) {
      console.error(`Unknown college: ${collegeFilter}`);
      process.exit(1);
    }
  }

  const allMappings: TransferMapping[] = [];

  for (const slug of slugs) {
    const rows = await scrapeCollege(slug);
    // Tag each row with the CC slug so we can trace back
    for (const row of rows) {
      // The CC prefix/number is already set; just ensure the cc_course is correct
      allMappings.push(row);
    }
    // Small polite delay between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n  Total: ${allMappings.length} mappings`);

  // Dedup by (cc_course, univ_course, univ_title)
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < allMappings.length) {
    console.log(`  After dedup: ${deduped.length} (dropped ${allMappings.length - deduped.length})`);
  }

  deduped.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number)
  );

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\n  ✓ Wrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && deduped.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`  Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
