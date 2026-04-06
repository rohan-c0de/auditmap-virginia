/**
 * scrape-transfer-usg.ts
 *
 * Scrapes transfer equivalency data from USG (University System of Georgia)
 * universities that use the shared BannerExtensibility Transfer Articulation
 * app. Currently supports:
 *   - Kennesaw State University (KSU)
 *   - University of West Georgia (UWG)
 *
 * Both use the identical AngularJS app with a multi-step wizard. The key
 * insight is that the app loads data via XHR to virtualDomains endpoints
 * which return clean JSON. We intercept those responses via Playwright
 * instead of fighting with the ui-grid DOM.
 *
 * Flow per college:
 *   1. Navigate to the Transfer Articulation page
 *   2. Click "Yes" (within US), select Georgia, click "Get State"
 *   3. Select school from dropdown, click "Get School"
 *   4. Select all subjects/levels/term via JS, click "Get Courses"
 *   5. Set page size to 120, collect paginated API responses
 *   6. Parse JSON records into TransferMapping[]
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-transfer-usg.ts
 *   npx tsx scripts/ga/scrape-transfer-usg.ts --university ksu
 *   npx tsx scripts/ga/scrape-transfer-usg.ts --college atlanta-tech
 */

import { chromium, type Page } from "playwright";
import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface USGRecord {
  ROW_NUMBER: number;
  CLASS_GROUP: string | null;
  CLASS_SUBJ_CRSE: string;
  CLASS_TITLE: string;
  CLASS_LEVL: string;
  CLASS_MIN_GRADE: string;
  EQUIV_SUBJ_CRSE: string;
  EQUIV_TITLE: string;
  EQUIV_CREDIT_HOURS: string;
}

// ---------------------------------------------------------------------------
// University configs
// ---------------------------------------------------------------------------

interface USGUniversity {
  slug: string;
  name: string;
  url: string;
}

const USG_UNIVERSITIES: Record<string, USGUniversity> = {
  ksu: {
    slug: "ksu",
    name: "Kennesaw State University",
    url: "https://bes-owlexpress.kennesaw.edu/BannerExtensibility/customPage/page/USGTransferArticulation",
  },
  uwg: {
    slug: "uwg",
    name: "University of West Georgia",
    url: "https://westga.gabest.usg.edu/BannerExtensibility/customPage/page/USGTransferArticulation",
  },
};

// TCSG colleges — names as they appear in the USG school dropdown
const TCSG_COLLEGES: Record<string, string> = {
  "albany-tech": "Albany Technical College",
  "athens-tech": "Athens Technical College",
  "atlanta-tech": "Atlanta Technical College",
  "augusta-tech": "Augusta Technical College",
  "central-ga-tech": "Central Georgia Technical College",
  "chattahoochee-tech": "Chattahoochee Technical College",
  "coastal-pines-tech": "Coastal Pines Technical College",
  "columbus-tech": "Columbus Technical College",
  "ga-northwestern-tech": "Georgia Northwestern Technical College",
  "ga-piedmont-tech": "Georgia Piedmont Technical College",
  "gwinnett-tech": "Gwinnett Technical College",
  "lanier-tech": "Lanier Technical College",
  "north-ga-tech": "North Georgia Technical College",
  "oconee-fall-line-tech": "Oconee Fall Line Technical College",
  "ogeechee-tech": "Ogeechee Technical College",
  "savannah-tech": "Savannah Technical College",
  "south-ga-tech": "South Georgia Technical College",
  "southeastern-tech": "Southeastern Technical College",
  "southern-crescent-tech": "Southern Crescent Technical College",
  "southern-regional-tech": "Southern Regional Technical College",
  "west-ga-tech": "West Georgia Technical College",
  "wiregrass-tech": "Wiregrass Georgia Technical College",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCourse(raw: string): { prefix: string; number: string } {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^([A-Z]{2,5})\s+(\S+)$/);
  if (match) return { prefix: match[1], number: match[2] };
  return { prefix: "", number: cleaned };
}

function recordToMapping(
  rec: USGRecord,
  uni: USGUniversity
): TransferMapping | null {
  const ccRaw = rec.CLASS_SUBJ_CRSE?.trim();
  const equivRaw = rec.EQUIV_SUBJ_CRSE?.trim();
  if (!ccRaw) return null;

  const cc = parseCourse(ccRaw);
  if (!cc.prefix) return null;

  const noCredit =
    !equivRaw ||
    rec.EQUIV_TITLE?.toLowerCase().includes("no credit") ||
    rec.EQUIV_TITLE?.toLowerCase().includes("not transfer");

  const equiv = noCredit ? { prefix: "", number: "" } : parseCourse(equivRaw);
  const univCourse = noCredit
    ? ""
    : `${equiv.prefix} ${equiv.number}`.trim();

  const isElective =
    !noCredit &&
    (equiv.number.includes("XXX") ||
      equiv.number.includes("xxx") ||
      rec.EQUIV_TITLE?.toLowerCase().includes("elective"));

  return {
    state: "ga",
    cc_prefix: cc.prefix,
    cc_number: cc.number,
    cc_course: `${cc.prefix} ${cc.number}`,
    cc_title: rec.CLASS_TITLE?.trim() || "",
    cc_credits: "",
    university: uni.slug,
    university_name: uni.name,
    univ_course: univCourse,
    univ_title: noCredit ? "Does not transfer" : rec.EQUIV_TITLE?.trim() || "",
    univ_credits: rec.EQUIV_CREDIT_HOURS?.trim() || "",
    notes: rec.CLASS_MIN_GRADE ? `Min grade: ${rec.CLASS_MIN_GRADE}` : "",
    no_credit: noCredit,
    is_elective: isElective,
  };
}

// ---------------------------------------------------------------------------
// Playwright scraper
// ---------------------------------------------------------------------------

async function scrapeUSGUniversity(
  uni: USGUniversity,
  targetCollege: string | null
): Promise<TransferMapping[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  const page = await context.newPage();
  const allMappings: TransferMapping[] = [];

  const colleges = targetCollege
    ? { [targetCollege]: TCSG_COLLEGES[targetCollege] }
    : TCSG_COLLEGES;

  let collegeIndex = 0;
  const total = Object.keys(colleges).length;

  for (const [slug, collegeName] of Object.entries(colleges)) {
    collegeIndex++;
    console.log(`  [${collegeIndex}/${total}] ${collegeName}:`);

    try {
      const mappings = await scrapeOneCollege(page, uni, collegeName);
      console.log(`    ${mappings.length} equivalencies`);
      allMappings.push(...mappings);
    } catch (err) {
      console.log(`    ⚠ Error: ${(err as Error).message}`);
    }

    if (collegeIndex < total) await sleep(1000);
  }

  await browser.close();
  return allMappings;
}

async function scrapeOneCollege(
  page: Page,
  uni: USGUniversity,
  collegeName: string
): Promise<TransferMapping[]> {
  // Collect all API responses for class_list
  let apiRecords: USGRecord[] = [];
  const responseHandler = async (resp: any) => {
    const url = resp.url();
    if (url.includes("virtualDomains") && url.includes("class_list")) {
      try {
        const json = await resp.json();
        if (Array.isArray(json)) {
          apiRecords.push(...json);
        }
      } catch {
        /* ignore parse errors */
      }
    }
  };
  page.on("response", responseHandler);

  try {
    // Navigate to transfer articulation page
    await page.goto(uni.url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 1: Click "Yes" for within US
    await page.click('button:has-text("Yes")');
    await page.waitForTimeout(800);

    // Step 2: Select Georgia → Get State
    await page.selectOption("#pbid-StateSelectList", { label: "Georgia" });
    await page.waitForTimeout(300);
    await page.click('button:has-text("Get State")');
    await page.waitForTimeout(2000);

    // Step 3: Select school
    const allSchools = await page.evaluate(() => {
      const sel = document.querySelector(
        "#pbid-SchoolSelectList"
      ) as HTMLSelectElement;
      return Array.from(sel?.options || []).map((o) => ({
        value: o.value,
        text: o.text,
      }));
    });

    // Find matching school (try exact, then partial)
    const nameLower = collegeName.toLowerCase();
    let match = allSchools.find(
      (s) => s.text.toLowerCase() === nameLower
    );
    if (!match) {
      // Partial match on first word
      const firstWord = nameLower.split(" ")[0];
      match = allSchools.find(
        (s) =>
          s.text.toLowerCase().includes(firstWord) &&
          s.text.toLowerCase().includes("technical")
      );
    }
    if (!match) {
      // Even more fuzzy — just the first word
      const firstWord = nameLower.split(" ")[0];
      match = allSchools.find((s) =>
        s.text.toLowerCase().includes(firstWord)
      );
    }

    if (!match || !match.value) {
      throw new Error(`"${collegeName}" not found in school dropdown`);
    }

    await page.selectOption("#pbid-SchoolSelectList", { value: match.value });
    await page.waitForTimeout(300);
    await page.click('button:has-text("Get School")');
    await page.waitForTimeout(2000);

    // Step 4: Select all subjects, levels, and latest term via JS
    await page.evaluate(() => {
      const subjSel = document.querySelector(
        "#pbid-SubjSelectList"
      ) as HTMLSelectElement;
      if (subjSel) {
        Array.from(subjSel.options).forEach((o) => (o.selected = true));
        subjSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const levelSel = document.querySelector(
        "#pbid-LevelSelectList"
      ) as HTMLSelectElement;
      if (levelSel) {
        Array.from(levelSel.options).forEach((o) => (o.selected = true));
        levelSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const termSel = document.querySelector(
        "#pbid-TermSelectList"
      ) as HTMLSelectElement;
      if (termSel) {
        const firstTerm = Array.from(termSel.options).find((o) => o.value);
        if (firstTerm) {
          termSel.value = firstTerm.value;
          firstTerm.selected = true;
          termSel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
    await page.waitForTimeout(300);

    // Clear any previously collected records and click Get Courses
    apiRecords = [];
    await page.click('button:has-text("Get Courses")');
    await page.waitForTimeout(3000);

    // Check if there are records — if yes, set page size to 120 to get more
    const recordCountText = await page.evaluate(() => {
      const el = document.body.innerText;
      const match = el.match(/Records Found:\s*(\d+)/);
      return match ? parseInt(match[1]) : 0;
    });

    if (recordCountText > 30) {
      // Change page size to 120
      const pageSizeSelects = page.locator("select").filter({ hasText: "120" });
      if ((await pageSizeSelects.count()) > 0) {
        await pageSizeSelects.first().selectOption("120");
        await page.waitForTimeout(3000);
      }

      // If still more than 120, need page 2
      if (recordCountText > 120) {
        // Click next page button
        const nextPage = page.locator(
          'button:has-text("Next"), .ui-grid-pager-next, [aria-label="Next page"]'
        );
        if ((await nextPage.count()) > 0) {
          await nextPage.first().click();
          await page.waitForTimeout(3000);
        }
      }
    }

    // Convert API records to mappings
    const mappings: TransferMapping[] = [];
    for (const rec of apiRecords) {
      const m = recordToMapping(rec, uni);
      if (m) mappings.push(m);
    }

    return mappings;
  } finally {
    page.removeListener("response", responseHandler);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("USG Transfer Articulation Scraper (Playwright)\n");

  const args = process.argv.slice(2);
  let targetUni: string | null = null;
  let targetCollege: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--university" && args[i + 1]) targetUni = args[i + 1];
    if (args[i] === "--college" && args[i + 1]) targetCollege = args[i + 1];
  }

  if (targetCollege && !TCSG_COLLEGES[targetCollege]) {
    console.error(`Unknown college: ${targetCollege}`);
    process.exit(1);
  }
  if (targetUni && !USG_UNIVERSITIES[targetUni]) {
    console.error(`Unknown university: ${targetUni}`);
    process.exit(1);
  }

  const universities = targetUni
    ? { [targetUni]: USG_UNIVERSITIES[targetUni] }
    : USG_UNIVERSITIES;

  const allMappings: TransferMapping[] = [];

  for (const [key, uni] of Object.entries(universities)) {
    console.log(`${uni.name} (${key}):`);
    const mappings = await scrapeUSGUniversity(uni, targetCollege);
    allMappings.push(...mappings);
    console.log(`  Subtotal: ${mappings.length} raw equivalencies\n`);
  }

  // Deduplicate across colleges (same course → same equiv at same university)
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_course}|${m.univ_course}|${m.university}|${m.no_credit}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }

  const transferable = deduped.filter((m) => !m.no_credit);

  console.log("Summary:");
  console.log(`  Raw: ${allMappings.length}`);
  console.log(`  After dedup: ${deduped.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(
    `    Direct: ${transferable.filter((m) => !m.is_elective).length}`
  );
  console.log(
    `    Elective: ${transferable.filter((m) => m.is_elective).length}`
  );

  if (deduped.length === 0) {
    console.log("\n⚠ No mappings found!");
    process.exit(1);
  }

  // Merge with existing data
  const outPath = path.join(
    process.cwd(),
    "data",
    "ga",
    "transfer-equiv.json"
  );
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    if (existing.length > 0) {
      console.log(`\nLoaded ${existing.length} existing mappings`);
    }
  } catch {
    /* no existing file */
  }

  const scrapedSlugs = new Set(Object.keys(universities));
  const preserved = existing.filter((m) => !scrapedSlugs.has(m.university));
  const merged = [...preserved, ...deduped];

  console.log(
    `Merged: ${preserved.length} preserved + ${deduped.length} new = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  try {
    const imported = await importTransfersToSupabase("ga");
    if (imported > 0) {
      console.log(`Imported ${imported} rows to Supabase`);
    }
  } catch (err) {
    console.log(`Supabase import skipped: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
