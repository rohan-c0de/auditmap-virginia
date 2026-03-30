/**
 * Scrape George Mason University VCCS Transfer Equivalency data.
 *
 * Source: https://transfermatrix.admissions.gmu.edu/
 * WordPress-based form with cascading dropdowns (state → school → course).
 * Select VA → USVCCS → "View All" to get the full results table.
 *
 * Merges GMU mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-gmu.ts
 *   npx tsx scripts/scrape-transfer-gmu.ts --headed
 */

import { chromium } from "playwright";
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

const GMU_URL = "https://transfermatrix.admissions.gmu.edu/";
const headed = process.argv.includes("--headed");

async function scrapeGmu(): Promise<TransferMapping[]> {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  console.log(`Navigating to ${GMU_URL}`);
  await page.goto(GMU_URL, { waitUntil: "networkidle", timeout: 30000 });

  // Step 1: Select Virginia
  console.log("Selecting state: VA");
  await page.selectOption("#state", "VA");
  await page.waitForTimeout(2000);

  // Wait for school dropdown to populate
  await page.waitForFunction(() => {
    const el = document.querySelector("#school") as HTMLSelectElement;
    return el && el.options.length > 2;
  }, { timeout: 15000 });

  // Step 2: Select VCCS
  console.log("Selecting school: USVCCS (Virginia Community College System)");
  await page.selectOption("#school", "USVCCS");
  await page.waitForTimeout(2000);

  // Wait for course dropdown to populate
  await page.waitForFunction(() => {
    const el = document.querySelector("#course") as HTMLSelectElement;
    return el && el.options.length > 5;
  }, { timeout: 15000 });

  // Step 3: Select "View All"
  console.log('Selecting course: "View All"');
  await page.selectOption("#course", "View All");
  await page.waitForTimeout(3000);

  // Wait for results to render
  console.log("Waiting for results to render...");
  // The results might be in a table, div, or other container
  // Wait for significant content to appear
  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return body.length > 5000; // Should have lots of content once loaded
  }, { timeout: 30000 });

  // Give extra time for large result set to fully render
  await page.waitForTimeout(3000);

  // Step 4: Parse results
  console.log("Parsing results...");

  const mappings = await page.evaluate(() => {
    const results: Array<{
      vccsCourse: string;
      vccsTitle: string;
      vccsCredits: string;
      gmuCourse: string;
      gmuTitle: string;
      gmuCredits: string;
    }> = [];

    // Strategy 1: Look for tables
    const tables = document.querySelectorAll("table");
    for (const table of tables) {
      const rows = table.querySelectorAll("tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 4) {
          results.push({
            vccsCourse: cells[0]?.textContent?.trim() || "",
            vccsTitle: cells.length >= 6 ? cells[1]?.textContent?.trim() || "" : "",
            vccsCredits: cells.length >= 6 ? cells[2]?.textContent?.trim() || "" : "",
            gmuCourse: cells.length >= 6 ? cells[3]?.textContent?.trim() || "" : cells[1]?.textContent?.trim() || "",
            gmuTitle: cells.length >= 6 ? cells[4]?.textContent?.trim() || "" : cells[2]?.textContent?.trim() || "",
            gmuCredits: cells.length >= 6 ? cells[5]?.textContent?.trim() || "" : cells[3]?.textContent?.trim() || "",
          });
        }
      }
    }

    // Strategy 2: Look for divs with course info
    if (results.length === 0) {
      // Look for any structured content with course patterns
      const allText = document.body.innerText;
      const lines = allText.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        // Look for patterns like "ACC 211 → ACCT 203" or "ACC 211 = ACCT 203"
        const match = line.match(
          /([A-Z]{2,4})\s+(\d{3}\S*)\s*(?:→|->|=|:)\s*([A-Z]{2,4})\s+(\d{3}\S*)/
        );
        if (match) {
          results.push({
            vccsCourse: `${match[1]} ${match[2]}`,
            vccsTitle: "",
            vccsCredits: "",
            gmuCourse: `${match[3]} ${match[4]}`,
            gmuTitle: "",
            gmuCredits: "",
          });
        }
      }
    }

    // Strategy 3: Get the raw page HTML for analysis if no results found
    if (results.length === 0) {
      // Return page structure info for debugging
      const body = document.body.innerHTML;
      const truncated = body.slice(0, 5000);
      results.push({
        vccsCourse: "__DEBUG__",
        vccsTitle: `Page length: ${body.length}`,
        vccsCredits: `Tables: ${tables.length}`,
        gmuCourse: truncated,
        gmuTitle: "",
        gmuCredits: "",
      });
    }

    return results;
  });

  await browser.close();

  // Check for debug output
  if (mappings.length === 1 && mappings[0].vccsCourse === "__DEBUG__") {
    console.log("\n⚠ Could not find structured results. Debug info:");
    console.log(`  ${mappings[0].vccsTitle}`);
    console.log(`  ${mappings[0].vccsCredits}`);
    console.log("\n  Page HTML preview:");
    console.log(mappings[0].gmuCourse?.slice(0, 2000));
    return [];
  }

  // Transform to TransferMapping
  const transferMappings: TransferMapping[] = [];

  for (const r of mappings) {
    if (!r.vccsCourse) continue;

    const vccsMatch = r.vccsCourse.match(/^([A-Z]{2,4})\s*[-\s]*(\d+\S*)/);
    if (!vccsMatch) continue;

    const vccsPrefix = vccsMatch[1];
    const vccsNumber = vccsMatch[2];

    // GMU patterns:
    // "COMM----" = elective (four dashes)
    // "ENGH 101" = direct
    // "L" designation = lower-level
    const isElective =
      r.gmuCourse.includes("----") ||
      r.gmuCourse.includes("XXX") ||
      r.gmuCourse.includes("ELEC");

    const noCredit =
      r.gmuCourse.toUpperCase().includes("NO CREDIT") ||
      r.gmuCourse.toUpperCase().includes("NO GMU CREDIT") ||
      r.gmuTitle.toUpperCase().includes("NO CREDIT");

    transferMappings.push({
      vccs_prefix: vccsPrefix,
      vccs_number: vccsNumber,
      vccs_course: `${vccsPrefix} ${vccsNumber}`,
      vccs_title: r.vccsTitle || "",
      vccs_credits: r.vccsCredits || "",
      university: "gmu",
      university_name: "George Mason University",
      univ_course: noCredit ? "" : r.gmuCourse,
      univ_title: noCredit ? "No GMU credit" : r.gmuTitle,
      univ_credits: noCredit ? "" : r.gmuCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = transferMappings.filter((m) => {
    const key = `${m.vccs_prefix}-${m.vccs_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Raw: ${transferMappings.length}, deduplicated: ${deduped.length}`);
  return deduped;
}

async function main() {
  console.log("GMU Transfer Equivalency Scraper\n");

  const gmuMappings = await scrapeGmu();

  if (gmuMappings.length === 0) {
    console.log("\n⚠ No mappings scraped! The page structure may have changed.");
    console.log("Try running with --headed to inspect the page visually.");
    process.exit(1);
  }

  // Stats
  const directEquiv = gmuMappings.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = gmuMappings.filter((m) => !m.no_credit && m.is_elective).length;
  const noCredit = gmuMappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(gmuMappings.map((m) => m.vccs_prefix));

  console.log(`\nGMU Summary:`);
  console.log(`  Total mappings: ${gmuMappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

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

  const nonGmu = existing.filter((m) => m.university !== "gmu");
  const merged = [...nonGmu, ...gmuMappings];

  console.log(
    `Merged: ${nonGmu.length} existing (non-GMU) + ${gmuMappings.length} GMU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
