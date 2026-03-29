/**
 * Quick probe to verify PeopleSoft Summer 2026 term code and data availability.
 * Tests: term code 2263, subject discovery, and card extraction for one subject.
 *
 * Usage: npx tsx scripts/_ps-summer-probe.ts
 */

import { chromium } from "playwright";

const PS_BASE = "https://ps-sis.vccs.edu";
const COLLEGE_CODE = "NV280"; // NOVA — known to have summer data
const NAV_TIMEOUT = 30_000;

// Term codes to try — Spring=2262, so Summer is likely 2263 or 2253
const TERM_CANDIDATES = ["2263", "2253", "2264"];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  console.log("=== PeopleSoft Summer 2026 Probe ===\n");

  // Step 1: Find the correct Summer 2026 term code
  let workingTerm: string | null = null;

  for (const termCode of TERM_CANDIDATES) {
    const url = `${PS_BASE}/psc/S92GUEST/EMPLOYEE/SA/c/VX_CUSTOM_SR.VX_SSR_CLSRCH_FL.GBL?COLLEGE=${COLLEGE_CODE}&TERM=${termCode}`;
    console.log(`Testing term code ${termCode}...`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await page.waitForTimeout(3000);

      // Check if the page loaded a valid search form (subject dropdown exists)
      const subjectDropdown = page.locator("#VX_CLSRCH_WRK2_SUBJECT");
      const isVisible = await subjectDropdown.isVisible({ timeout: 10000 }).catch(() => false);

      if (isVisible) {
        // Read the page title/header to confirm which term we're in
        const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "");
        const hasSummer = bodyText.toLowerCase().includes("summer");
        const hasSpring = bodyText.toLowerCase().includes("spring");
        const hasFall = bodyText.toLowerCase().includes("fall");
        console.log(`  ✓ Term ${termCode}: page loaded, subject dropdown visible`);
        console.log(`  Term mentions: summer=${hasSummer}, spring=${hasSpring}, fall=${hasFall}`);

        // Count subjects in dropdown
        const optionCount = await subjectDropdown.locator("option").count();
        console.log(`  Subjects available: ${optionCount - 1}`); // minus the blank/default option

        if (hasSummer || (!hasSpring && !hasFall)) {
          workingTerm = termCode;
          console.log(`  → Using term code ${termCode}\n`);
          break;
        }
      } else {
        console.log(`  ✗ Term ${termCode}: no search form found`);
      }
    } catch (err) {
      console.log(`  ✗ Term ${termCode}: error — ${(err as Error).message}`);
    }
  }

  if (!workingTerm) {
    console.log("Could not find a working Summer 2026 term code. Trying to read term dropdown...");
    // Navigate to a known working page and inspect the term options
    const url = `${PS_BASE}/psc/S92GUEST/EMPLOYEE/SA/c/VX_CUSTOM_SR.VX_SSR_CLSRCH_FL.GBL?COLLEGE=${COLLEGE_CODE}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(5000);
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || "");
    console.log("Page text (first 1000 chars):\n", bodyText.substring(0, 1000));
    await browser.close();
    return;
  }

  // Step 2: Test extracting one subject (ENG)
  console.log("Step 2: Searching for ENG courses...");
  const subjectDropdown = page.locator("#VX_CLSRCH_WRK2_SUBJECT");
  await subjectDropdown.selectOption({ label: "ENG-English" }).catch(async () => {
    // Try partial match
    const options = await page.evaluate(() => {
      const sel = document.getElementById("VX_CLSRCH_WRK2_SUBJECT") as HTMLSelectElement;
      return Array.from(sel?.options || []).map(o => ({ value: o.value, text: o.text }));
    });
    const engOpt = options.find(o => o.text.includes("ENG"));
    if (engOpt) {
      await subjectDropdown.selectOption(engOpt.value);
      console.log(`  Selected: ${engOpt.text}`);
    } else {
      console.log("  Could not find ENG in dropdown. Available options:");
      options.slice(0, 20).forEach(o => console.log(`    ${o.value}: ${o.text}`));
    }
  });

  // Click search
  const searchBtn = page.locator("#VX_CLSRCH_WRK2_SEARCH_BTN");
  await searchBtn.click();
  console.log("  Clicked search...");

  // Wait for results
  try {
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return text.includes("Class Nbr") || text.includes("No results") || text.includes("no classes");
      },
      { timeout: 20000 }
    );
  } catch {
    console.log("  Timeout waiting for results");
  }

  // Dismiss modal if present
  const modal = page.locator("#pt_modalMask");
  if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log("  Dismissing 250-result modal...");
    await page.evaluate(() => {
      const mask = document.getElementById("pt_modalMask");
      if (mask) mask.click();
    });
    await page.waitForTimeout(1000);
  }

  // Step 3: Extract sample data from result cards
  console.log("\nStep 3: Extracting sample sections...\n");
  const sections = await page.evaluate(() => {
    const results: Record<string, string>[] = [];
    for (let i = 0; i < 5; i++) {
      const title = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA$${i}`) as HTMLElement)?.innerText?.trim();
      if (!title) break;

      const status = (document.querySelector(`[id*="VX_RSLT_NAV_WK_HTMLAREA1"][id$="$$${i}"], [id*="VX_RSLT_NAV_WK_HTMLAREA1"][id$="$${i}"]`) as HTMLElement)?.innerText?.trim();
      const sectionCrn = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA2$${i}`) as HTMLElement)?.innerText?.trim();
      const times = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA3$${i}`) as HTMLElement)?.innerText?.trim();
      const dates = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA4$${i}`) as HTMLElement)?.innerText?.trim();
      const instrLoc = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA5$${i}`) as HTMLElement)?.innerText?.trim();

      results.push({
        title: title || "?",
        status: status || "?",
        sectionCrn: sectionCrn || "?",
        times: times || "?",
        dates: dates || "?",
        instrLoc: instrLoc || "?",
      });
    }
    return results;
  });

  if (sections.length === 0) {
    console.log("No sections found. Page text:");
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "");
    console.log(bodyText.substring(0, 1000));
  } else {
    console.log(`Found ${sections.length} sample sections:\n`);
    for (const s of sections) {
      console.log(`  Title:      ${s.title}`);
      console.log(`  Status:     ${s.status}`);
      console.log(`  Section/CRN: ${s.sectionCrn}`);
      console.log(`  Times:      ${s.times}`);
      console.log(`  Dates:      ${s.dates}`);
      console.log(`  Instr+Loc:  ${s.instrLoc}`);
      console.log();
    }
  }

  // Count total results on page
  const totalClassNbrs = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    return (text.match(/Class Nbr/g) || []).length;
  });
  console.log(`Total "Class Nbr" occurrences on this page: ${totalClassNbrs}`);

  await browser.close();
  console.log("\n=== Probe complete ===");
}

main().catch(console.error);
