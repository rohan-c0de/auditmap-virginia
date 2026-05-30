/**
 * scrape-transfer-mainestreet.ts
 *
 * Scrapes in-state transfer equivalencies from UMaine's MaineStreet
 * Transfer Equivalency Guest portal (PeopleSoft Classic, no login).
 *
 * For each combination of MCCS sending college (7) × UMS receiving
 * campus (6), navigates the stateful PeopleSoft form, clicks
 * "Show All Subjects", and extracts the equivalency grid.
 *
 * Usage:
 *   npx tsx scripts/me/scrape-transfer-mainestreet.ts
 *   npx tsx scripts/me/scrape-transfer-mainestreet.ts --no-import
 */

import fs from "fs";
import path from "path";
import { chromium, type Page, type Frame } from "playwright";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORTAL_URL =
  "https://mainestreetcs.maine.edu/psp/CSPRDG/EMPLOYEE/SA/c/UM_SA.UM_TRNSFER_GUEST.GBL";

interface UmsTarget {
  radioId: string;
  slug: string;
  name: string;
}

const UMS_TARGETS: UmsTarget[] = [
  { radioId: "UM_TRNEQUIV_DRV_UM_SFOE", slug: "uma", name: "University of Maine at Augusta" },
  { radioId: "UM_TRNEQUIV_DRV_UM_SFOE$112$", slug: "umf", name: "University of Maine at Farmington" },
  { radioId: "UM_TRNEQUIV_DRV_UM_SFOE$113$", slug: "umfk", name: "University of Maine at Fort Kent" },
  { radioId: "UM_TRNEQUIV_DRV_UM_SFOE$115$", slug: "umaine", name: "University of Maine & University of Maine at Machias" },
  { radioId: "UM_TRNEQUIV_DRV_UM_SFOE$116$", slug: "usm", name: "University of Southern Maine" },
  { radioId: "UM_TRNEQUIV_DRV_UM_SFOE$117$", slug: "umpi", name: "University of Maine at Presque Isle" },
];

interface MccsCollege {
  slug: string;
  name: string;
  portalName: string;
  letter: string;
}

const MCCS_COLLEGES: MccsCollege[] = [
  { slug: "cmcc", name: "Central Maine Community College", portalName: "Central Maine Cmty College", letter: "C" },
  { slug: "emcc", name: "Eastern Maine Community College", portalName: "Eastern Maine Cmty College", letter: "E" },
  { slug: "kvcc", name: "Kennebec Valley Community College", portalName: "Kennebec Valley Cmty Coll", letter: "K" },
  { slug: "nmcc", name: "Northern Maine Community College", portalName: "Northern Maine Cmty College", letter: "N" },
  { slug: "smcc", name: "Southern Maine Community College", portalName: "Southern Maine Cmty College", letter: "S" },
  { slug: "wccc", name: "Washington County Community College", portalName: "Washington County Cmty Coll", letter: "W" },
  { slug: "yccc", name: "York County Community College", portalName: "York County Cmty College", letter: "Y" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeCourse(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isElectiveCourse(course: string, title: string): boolean {
  if (/X{2,}$/.test(course.split(" ").pop() || "")) return true;
  const t = title.toLowerCase();
  if (/^(elective|transfer\s+credit|general\s+elective)/.test(t)) return true;
  if (/elective\s*-?\s*\d{3}\s*level/i.test(t)) return true;
  return false;
}

async function getFrame(page: Page): Promise<Frame> {
  const frame = page.frame("TargetContent");
  if (!frame) throw new Error("TargetContent frame not found");
  return frame;
}

async function waitForPS(page: Page, ms = 5000): Promise<void> {
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------------------
// Scrape one (MCCS college → UMS campus) pair
// ---------------------------------------------------------------------------

async function scrapePair(
  page: Page,
  cc: MccsCollege,
  ums: UmsTarget,
): Promise<TransferMapping[]> {
  // Step 1: Navigate to landing and click "Transfer courses..."
  await page.goto(PORTAL_URL, { waitUntil: "networkidle", timeout: 60000 });
  await waitForPS(page, 4000);

  const contentFrame = await getFrame(page);
  await contentFrame.click("#UM_TRNEQUIV_DRV_UM_CLEAR_PB");
  await waitForPS(page, 5000);

  // Step 2: Select UMS target radio button
  const f2 = await getFrame(page);
  await f2.click(`[id="${ums.radioId}"]`);
  await waitForPS(page, 1000);

  // Step 3: Click letter for MCCS college
  await f2.click(`#UM_TRSFR1_WRK_SSR_ALPHANUM_${cc.letter}`);
  await waitForPS(page, 5000);

  // Step 4: Find and click the MCCS college in the institution list
  const f3 = await getFrame(page);
  const ccLinkId = await f3.evaluate((portalName: string) => {
    const links = Array.from(document.querySelectorAll("a"));
    for (const link of links) {
      const text = link.textContent?.trim() || "";
      if (text === portalName || text.includes(portalName)) {
        return link.id;
      }
    }
    return null;
  }, cc.portalName);

  if (!ccLinkId) {
    console.log(`    ${cc.slug} not found in ${ums.slug}'s list under letter ${cc.letter} — skipping`);
    return [];
  }

  await f3.click(`[id="${ccLinkId}"]`);
  await waitForPS(page, 5000);

  // Step 5: Click "Show All Subjects"
  const f4 = await getFrame(page);
  const hasShowAll = await f4.evaluate(() => !!document.getElementById("UM_TRSFR1_WRK_ALL_VALUES"));
  if (!hasShowAll) {
    console.log(`    ${cc.slug} → ${ums.slug}: no subject page — skipping`);
    return [];
  }
  await f4.click("#UM_TRSFR1_WRK_ALL_VALUES");
  await waitForPS(page, 10000);

  // Step 6: Extract all rows from the equivalency grid
  const f5 = await getFrame(page);
  const rows = await f5.evaluate(() => {
    const results: {
      fromCourse: string;
      fromTitle: string;
      fromUnits: string;
      toCourse: string;
      toTitle: string;
      toUnits: string;
      genEd: string;
      isMore: boolean;
    }[] = [];

    let i = 0;
    while (true) {
      const fromEl = document.getElementById(`UM_TRNS_EXT_VW_UM_FROM_COURSE$${i}`);
      if (!fromEl) break;

      const fromCourse = fromEl.textContent?.trim() || "";
      const fromTitle = document.getElementById(`UM_TRNS_EXT_VW_DESCR$${i}`)?.textContent?.trim() || "";
      const fromUnits = document.getElementById(`UM_TRNS_EXT_VW_EXT_UNITS$${i}`)?.textContent?.trim() || "";
      const toCourse = document.getElementById(`EDIT_PB$span$${i}`)?.textContent?.trim() || "";
      const toTitle = document.getElementById(`UM_TRNS_EXT_VW_DESCR1$${i}`)?.textContent?.trim() || "";
      const toUnits = document.getElementById(`UM_TRNS_EXT_VW_UM_UM_UNITS$${i}`)?.textContent?.trim() || "";
      const genEd = document.getElementById(`UM_TRNS_EXT_VW_DESCRFORMAL$${i}`)?.textContent?.trim() || "";
      const isMore = toCourse === "More...";

      results.push({ fromCourse, fromTitle, fromUnits, toCourse, toTitle, toUnits, genEd, isMore });
      i++;
    }
    return results;
  });

  // Convert to TransferMapping format
  const mappings: TransferMapping[] = [];
  for (const row of rows) {
    if (row.isMore) continue;

    const normalized = normalizeCourse(row.toCourse);
    if (!row.fromCourse || !normalized) continue;

    const srcParts = row.fromCourse.match(/^([A-Z]+)\s+(.+)$/);
    if (!srcParts) continue;
    const ccPrefix = srcParts[1];
    const ccNumber = srcParts[2];

    const isElective = isElectiveCourse(normalized, row.toTitle);

    const notesParts: string[] = [`[${cc.slug}]`];
    if (row.genEd) notesParts.push(`Gen Ed: ${row.genEd}`);
    const notes = notesParts.join(" ");

    mappings.push({
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: row.fromTitle,
      cc_credits: row.fromUnits,
      university: ums.slug,
      university_name: ums.name,
      univ_course: normalized,
      univ_title: row.toTitle,
      univ_credits: row.toUnits,
      notes,
      no_credit: false,
      is_elective: isElective,
    });
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipImport = args.includes("--no-import");

  console.log("MaineStreet Transfer Equivalency Scraper\n");
  console.log(`  ${MCCS_COLLEGES.length} MCCS colleges × ${UMS_TARGETS.length} UMS targets = ${MCCS_COLLEGES.length * UMS_TARGETS.length} pairs\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const all: TransferMapping[] = [];
  let pairCount = 0;
  const pairTotal = MCCS_COLLEGES.length * UMS_TARGETS.length;

  for (const ums of UMS_TARGETS) {
    for (const cc of MCCS_COLLEGES) {
      pairCount++;
      process.stdout.write(`  [${pairCount}/${pairTotal}] ${cc.slug} → ${ums.slug}…`);

      try {
        const mappings = await scrapePair(page, cc, ums);
        all.push(...mappings);
        console.log(` ${mappings.length} mappings`);
      } catch (err) {
        console.log(` FAILED: ${(err as Error).message.slice(0, 100)}`);
      }

      await sleep(500);
    }
  }

  await browser.close();

  // Summary
  const transferable = all.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university_name, (byUniv.get(m.university_name) || 0) + 1);
  }

  const bySource = new Map<string, number>();
  for (const m of all) {
    const slug = m.notes.match(/^\[(\w+)\]/)?.[1] || "?";
    bySource.set(slug, (bySource.get(slug) || 0) + 1);
  }

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${all.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  Unique target universities: ${byUniv.size}`);
  console.log("\n  Per-target counts:");
  for (const [univ, count] of byUniv) {
    console.log(`    ${univ}: ${count}`);
  }
  console.log("\n  Per-source counts:");
  for (const [slug, count] of bySource) {
    console.log(`    ${slug}: ${count}`);
  }

  // Write output
  const outPath = path.join(process.cwd(), "data", "me", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`\nSaved ${all.length} mappings → ${outPath}`);

  // Import to Supabase
  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("me");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
