/**
 * Scrape Old Dominion University VCCS Transfer Equivalency data.
 *
 * Source: https://courses.odu.edu/equivalency/
 * Uses Playwright to drive the form. The form has:
 *   - State: #sel1 (VA pre-selected)
 *   - School: #school (populated via AJAX from data.php)
 *   - Subject: #subject (populated via AJAX from subject.php)
 *   - Course: #course (populated via AJAX from courseselect.php)
 *   - Submit: button[name="landing_submit"]
 *
 * Strategy: Select school "00VCCS", then for each subject, select each course
 * number individually and submit the form to get the equivalency result.
 *
 * Merges ODU mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-odu.ts
 *   npx tsx scripts/scrape-transfer-odu.ts --headed
 */

import { chromium, type Page } from "playwright";
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

const ODU_URL = "https://courses.odu.edu/equivalency/";
const headed = process.argv.includes("--headed");

// Only process standard VCCS subject codes
function isVccsSubject(code: string): boolean {
  return /^[A-Z]{2,4}$/.test(code);
}

/**
 * Get VCCS subject list from the backend directly (faster than form interaction).
 */
async function getSubjects(): Promise<string[]> {
  const res = await fetch("https://courses.odu.edu/equivalency/subject.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "school_id=00VCCS",
  });
  const html = await res.text();
  const matches = [...html.matchAll(/value\s*=\s*"([^"]+)"/g)];
  return matches
    .map((m) => m[1].trim())
    .filter((v) => v && isVccsSubject(v));
}

/**
 * Get course numbers for a subject from the backend.
 */
async function getCourseNumbers(subjectCode: string): Promise<string[]> {
  const res = await fetch("https://courses.odu.edu/equivalency/courseselect.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `school_id=00VCCS&subject_id=${subjectCode}`,
  });
  const html = await res.text();
  const matches = [...html.matchAll(/value\s*=\s*"([^"]+)"/g)];
  return matches.map((m) => m[1].trim()).filter((v) => v);
}

/**
 * Navigate to the equivalency page with form fields pre-set and extract results.
 */
async function getEquivalency(
  page: Page,
  subject: string,
  courseNum: string
): Promise<TransferMapping | null> {
  // Use the form: set values and submit
  try {
    // Navigate with GET params approach
    await page.goto(ODU_URL, { waitUntil: "domcontentloaded", timeout: 15000 });

    // Virginia is pre-selected. Wait for page, then trigger school load.
    await page.waitForSelector("#sel1", { timeout: 5000 });

    // Trigger the state change to load schools
    await page.evaluate(() => {
      const stateEl = document.querySelector("#sel1") as HTMLSelectElement;
      if (stateEl) {
        stateEl.value = "VA";
        stateEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(1500);

    // Wait for school dropdown to be populated
    await page.waitForFunction(
      () => {
        const el = document.querySelector("#school") as HTMLSelectElement;
        return el && el.options.length > 2;
      },
      { timeout: 10000 }
    );

    // Select VCCS
    await page.selectOption("#school", "00VCCS");
    await page.waitForTimeout(1000);

    // Wait for subject dropdown
    await page.waitForFunction(
      () => {
        const el = document.querySelector("#subject") as HTMLSelectElement;
        return el && el.options.length > 2;
      },
      { timeout: 10000 }
    );

    // Select subject
    await page.selectOption("#subject", subject);
    await page.waitForTimeout(1000);

    // Wait for course dropdown
    await page.waitForFunction(
      () => {
        const el = document.querySelector("#course") as HTMLSelectElement;
        return el && el.options.length > 1;
      },
      { timeout: 10000 }
    );

    // Select course
    await page.selectOption("#course", courseNum);
    await page.waitForTimeout(500);

    // Click search
    await page.click('button[name="landing_submit"]');
    await page.waitForTimeout(2000);

    // Extract results from the page
    const result = await page.evaluate(() => {
      // Look for result content — could be table, div, or other
      const body = document.body.innerText;

      // Look for patterns like ODU equivalency display
      // The result usually shows: VCCS course → ODU course with credits
      const tables = document.querySelectorAll("table");
      for (const table of tables) {
        const rows = table.querySelectorAll("tr");
        for (const row of rows) {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            return {
              col1: cells[0]?.textContent?.trim() || "",
              col2: cells[1]?.textContent?.trim() || "",
              col3: cells[2]?.textContent?.trim() || "",
              col4: cells[3]?.textContent?.trim() || "",
              col5: cells[4]?.textContent?.trim() || "",
              col6: cells[5]?.textContent?.trim() || "",
              allText: body.slice(0, 2000),
            };
          }
        }
      }

      return { col1: "", col2: "", col3: "", col4: "", col5: "", col6: "", allText: body.slice(0, 2000) };
    });

    if (!result.col1 && !result.col4) return null;

    // Parse the result
    const oduCourse = result.col4 || result.col2 || "";
    const oduTitle = result.col5 || result.col3 || "";
    const oduCredits = result.col6 || "";

    const isElective = oduCourse.includes("XX") || oduCourse.includes("TREL") || oduCourse.includes("ELEC");
    const noCredit = oduCourse.toUpperCase().includes("NO CREDIT") || oduTitle.toUpperCase().includes("NO CREDIT");

    return {
      vccs_prefix: subject,
      vccs_number: courseNum,
      vccs_course: `${subject} ${courseNum}`,
      vccs_title: result.col2 || "",
      vccs_credits: result.col3 || "",
      university: "odu",
      university_name: "Old Dominion University",
      univ_course: noCredit ? "" : oduCourse,
      univ_title: noCredit ? "No ODU credit" : oduTitle,
      univ_credits: noCredit ? "" : oduCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    };
  } catch {
    return null;
  }
}

async function scrapeOdu(): Promise<TransferMapping[]> {
  // Step 1: Get subject list via direct API (no browser needed)
  console.log("Fetching VCCS subject list from ODU backend...");
  const allSubjects = await getSubjects();
  console.log(`Found ${allSubjects.length} VCCS subjects\n`);

  // Step 2: For each subject, get course numbers via direct API
  const subjectCourses: Map<string, string[]> = new Map();
  let totalCourses = 0;

  for (const subj of allSubjects) {
    const courses = await getCourseNumbers(subj);
    if (courses.length > 0) {
      subjectCourses.set(subj, courses);
      totalCourses += courses.length;
    }
  }

  console.log(`Total: ${subjectCourses.size} subjects with ${totalCourses} courses to scrape`);
  console.log("This will take a while — each course requires a form submission.\n");

  // Step 3: Use Playwright to get actual equivalency results
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  const allMappings: TransferMapping[] = [];
  let processed = 0;
  let failed = 0;

  for (const [subject, courses] of subjectCourses) {
    process.stdout.write(`  ${subject} (${courses.length} courses)...`);
    let subjectMappings = 0;

    for (const courseNum of courses) {
      const mapping = await getEquivalency(page, subject, courseNum);
      if (mapping) {
        allMappings.push(mapping);
        subjectMappings++;
      } else {
        failed++;
      }
      processed++;
    }

    console.log(` ${subjectMappings} mapped`);
  }

  await browser.close();

  console.log(`\nProcessed ${processed} courses, mapped ${allMappings.length}, failed ${failed}`);
  return allMappings;
}

async function main() {
  console.log("ODU Transfer Equivalency Scraper\n");

  const oduMappings = await scrapeOdu();

  if (oduMappings.length === 0) {
    console.log("\n⚠ No mappings scraped! The page structure may have changed.");
    console.log("Try running with --headed to inspect the page visually.");
    process.exit(1);
  }

  // Stats
  const directEquiv = oduMappings.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = oduMappings.filter((m) => !m.no_credit && m.is_elective).length;
  const noCredit = oduMappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(oduMappings.map((m) => m.vccs_prefix));

  console.log(`\nODU Summary:`);
  console.log(`  Total mappings: ${oduMappings.length}`);
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

  const nonOdu = existing.filter((m) => m.university !== "odu");
  const merged = [...nonOdu, ...oduMappings];

  console.log(
    `Merged: ${nonOdu.length} existing (non-ODU) + ${oduMappings.length} ODU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
