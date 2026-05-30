/**
 * scrape-transfer-clemson.ts
 *
 * Scrapes transfer equivalency data from Clemson University's public
 * Transfer Equivalency tool for all SC technical colleges.
 * Uses direct HTTP (no browser needed).
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-transfer-clemson.ts
 *   npx tsx scripts/sc/scrape-transfer-clemson.ts --college greenville
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://transferringcredits.app.clemson.edu";

// SC technical colleges → Clemson FICE codes
const SC_TECH_COLLEGES: Record<string, { fice: string; name: string }> = {
  "aiken":              { fice: "010056", name: "Aiken Tech College" },
  "central-carolina":   { fice: "003995", name: "Central Carolina Tech College" },
  "denmark":            { fice: "005363", name: "Denmark Tech College" },
  "florence-darlington": { fice: "003990", name: "Florence-Darlington Tech Coll" },
  "greenville":         { fice: "003991", name: "Greenville Tech College" },
  "horry-georgetown":   { fice: "004925", name: "Horry-Georgetown Tech College" },
  "midlands":           { fice: "003993", name: "Midlands Tech College" },
  "northeastern":       { fice: "007602", name: "Northeastern Tech College" },
  "orangeburg-calhoun": { fice: "006815", name: "Orangeburg-Calhoun Tech Coll" },
  "piedmont":           { fice: "003992", name: "Piedmont Tech College" },
  "spartanburg":        { fice: "003994", name: "Spartanburg Cmty College" },
  "lowcountry":         { fice: "009910", name: "Tech College of the Lowcountry" },
  "tri-county":         { fice: "004926", name: "Tri-County Tech College" },
  "trident":            { fice: "004920", name: "Trident Tech College" },
  "williamsburg":       { fice: "009322", name: "Williamsburg Tech College" },
  "york":               { fice: "003996", name: "York Tech College" },
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

function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRegex = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = trRegex.exec(html)) !== null) {
    rows.push([
      match[1].replace(/<[^>]*>/g, "").trim(),
      match[2].replace(/<[^>]*>/g, "").trim(),
      match[3].replace(/<[^>]*>/g, "").trim(),
    ]);
  }
  return rows;
}

function getTotalCount(html: string): number {
  const match = html.match(/Showing \d+ - \d+ of (\d+)/);
  return match ? parseInt(match[1]) : 0;
}

async function scrapeCollege(
  slug: string,
  fice: string,
  cookies: string
): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];
  let row = 0;
  let total = 0;

  do {
    const url = `${BASE_URL}/all-equivalencies.php?nation=US&state=SC&city=0&college=${fice}&all_equivs=&row=${row}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Cookie: cookies,
      },
    });

    if (!resp.ok) {
      console.error(`  HTTP ${resp.status} at row=${row}`);
      break;
    }

    const html = await resp.text();

    if (row === 0) {
      total = getTotalCount(html);
      if (total === 0) {
        console.log(`  No equivalencies found`);
        return [];
      }
    }

    const rows = extractRows(html);
    if (rows.length === 0) break;

    for (const [ccCourse, univCourse, univTitle] of rows) {
      // Parse cc course: "ACC 101" → prefix=ACC, number=101
      const ccParts = ccCourse.match(/^([A-Z]{2,4})\s+(\d{3}[A-Z]?)$/);
      if (!ccParts) continue;

      const [, ccPrefix, ccNumber] = ccParts;

      // Parse univ course: "ACCT 2010" or "NCT 0001" or "ELEC 0001"
      const univParts = univCourse.match(/^([A-Z]{2,4})\s+(\S+)$/);
      const univCourseStr = univParts ? univCourse : univCourse;

      const noCred = univCourse === "NCT 0001" || univTitle.toLowerCase().includes("not college transferable");
      const isElective = univCourse.includes("ELEC") || univTitle.toLowerCase().includes("elective");

      mappings.push({
        cc_prefix: ccPrefix,
        cc_number: ccNumber,
        cc_course: ccCourse,
        cc_title: "", // Clemson doesn't provide CC course titles
        cc_credits: "", // Not provided
        university: "clemson",
        university_name: "Clemson University",
        univ_course: univCourseStr,
        univ_title: univTitle,
        univ_credits: "", // Not provided on this page
        notes: "",
        no_credit: noCred,
        is_elective: isElective,
      });
    }

    row += 25; // Page size is 25
    if (row < total) {
      await sleep(200);
    }
  } while (row < total);

  return mappings;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const targetSlug = collegeIdx >= 0 ? args[collegeIdx + 1] : null;

  // Get session cookie
  const initResp = await fetch(`${BASE_URL}/transferequivalency.php`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  const setCookies = initResp.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

  const targets = targetSlug
    ? [[targetSlug, SC_TECH_COLLEGES[targetSlug]] as const]
    : (Object.entries(SC_TECH_COLLEGES) as [string, { fice: string; name: string }][]);

  if (targetSlug && !SC_TECH_COLLEGES[targetSlug]) {
    console.error(`Unknown college: ${targetSlug}`);
    console.error(`Available: ${Object.keys(SC_TECH_COLLEGES).join(", ")}`);
    process.exit(1);
  }

  console.log(`Scraping Clemson transfer equivalencies for ${targets.length} college(s)...\n`);

  const allMappings: TransferMapping[] = [];

  for (const [slug, college] of targets) {
    console.log(`${slug} (${college.name}, FICE ${college.fice}):`);
    const mappings = await scrapeCollege(slug, college.fice, cookies);
    console.log(`  ${mappings.length} equivalencies (${mappings.filter((m) => !m.no_credit).length} transferable)\n`);
    allMappings.push(...mappings);
    await sleep(300);
  }

  // Filter out NCT (not college transferable) entries — they add noise
  const transferable = allMappings.filter((m) => !m.no_credit);

  // Dedupe: iterating 16 colleges can produce identical equivalencies
  const seen = new Set<string>();
  const deduped = transferable.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const dupeCount = transferable.length - deduped.length;
  console.log(`\nTotal: ${allMappings.length} equivalencies, ${transferable.length} transferable`);
  if (dupeCount > 0) console.log(`Removed ${dupeCount} duplicates → ${deduped.length} unique`);

  if (deduped.length > 0) {
    const outPath = path.join(process.cwd(), "data", "sc", "transfer-equiv.json");
    fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
    console.log(`Written to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
