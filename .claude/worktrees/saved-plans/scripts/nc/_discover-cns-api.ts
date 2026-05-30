/**
 * _discover-cns-api.ts — Phase 2: Submit actual search and capture AJAX response.
 *
 * Usage:
 *   npx tsx scripts/nc/_discover-cns-api.ts
 *   npx tsx scripts/nc/_discover-cns-api.ts --headed
 */

import { chromium } from "playwright";

const BASE_URL = "https://coursetransfer.northcarolina.edu";
const headed = process.argv.includes("--headed");

async function main() {
  console.log("=== CNS API Discovery — Phase 2 ===\n");

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept XHR/fetch requests
  const captured: { url: string; method: string; postData?: string; body?: string; status?: number }[] = [];

  page.on("response", async (res) => {
    const req = res.request();
    if (req.resourceType() === "xhr" || req.resourceType() === "fetch") {
      const url = req.url();
      if (url.includes("google") || url.includes("analytics")) return;
      let body = "";
      try { body = await res.text(); } catch {}
      captured.push({
        url,
        method: req.method(),
        postData: req.postData() || undefined,
        body: body.slice(0, 5000),
        status: res.status(),
      });
    }
  });

  // Navigate
  console.log("1. Loading search page...");
  await page.goto(`${BASE_URL}/search`, { waitUntil: "networkidle" });

  // Select NCCCS from the "Credit From" dropdown
  console.log("2. Selecting NCCCS from 'Credit From' dropdown...");
  // Find the select with name containing "from"
  const fromSelect = await page.$("select[name*='from']");
  if (!fromSelect) {
    // Try by finding all selects and picking the one with NCCC option
    const selects = await page.$$("select");
    for (const sel of selects) {
      const hasNccc = await sel.$("option[value='NCCC']");
      if (hasNccc) {
        await sel.selectOption("NCCC");
        console.log("   Selected NCCC");
        break;
      }
    }
  } else {
    await fromSelect.selectOption("NCCC");
    console.log("   Selected NCCC via name match");
  }

  await page.waitForTimeout(1000);

  // Try search #1: No subject filter — just NCCCS
  console.log("\n3. Submitting search (no subject filter)...");
  captured.length = 0;

  const searchBtn = await page.$(".search-btn, button[type='submit'], input[type='submit'], button.btn-primary");
  if (searchBtn) {
    await searchBtn.click();
    console.log("   Clicked search button. Waiting for response...");
    await page.waitForTimeout(8000);
  }

  // Check captured requests
  console.log(`\n4. Captured ${captured.length} XHR requests:`);
  for (const req of captured) {
    console.log(`\n   ${req.method} ${req.url} → ${req.status}`);
    if (req.postData) console.log(`   POST data: ${req.postData}`);
    if (req.body) {
      console.log(`   Response body (first 3000 chars):`);
      console.log(req.body.slice(0, 3000));
    }
  }

  // Check page for results
  console.log("\n5. Results in page:");
  const resultsHtml = await page.evaluate(() => {
    const el = document.querySelector("#searchResults, .search-results, .results, table");
    if (!el) return "(no results container found)";
    return el.outerHTML.slice(0, 3000);
  });
  console.log(resultsHtml.slice(0, 2000));

  // Check current URL (may have changed)
  console.log("\n6. Current URL:", page.url());

  // Check if results loaded via page navigation instead of AJAX
  const pageContent = await page.content();
  const hasTable = pageContent.includes("<table");
  const hasResults = pageContent.includes("search-result") || pageContent.includes("course-row");
  console.log(`\n7. Page has <table>: ${hasTable}, has search results: ${hasResults}`);

  // If the URL changed, this might be a server-rendered form submission
  if (page.url() !== `${BASE_URL}/search`) {
    console.log("   URL changed — server-side form submission detected!");
    console.log("   Looking for result tables...");

    const tables = await page.$$eval("table", (tables) =>
      tables.map((t) => ({
        rows: t.rows.length,
        firstRow: t.rows[0]?.textContent?.trim().slice(0, 200) || "",
        html: t.outerHTML.slice(0, 1000),
      }))
    );
    tables.forEach((t, i) => {
      console.log(`\n   Table ${i}: ${t.rows} rows`);
      console.log(`   Header: ${t.firstRow}`);
      console.log(`   HTML: ${t.html}`);
    });
  }

  // Also try the Compare Schools mode
  console.log("\n\n=== Compare Schools Mode ===");
  await page.goto(`${BASE_URL}/search`, { waitUntil: "networkidle" });

  // Click the Compare Schools tab
  const compareTab = await page.$("a[href*='compare'], [data-toggle*='compare'], .compare-tab, li:nth-child(2) a");
  if (compareTab) {
    await compareTab.click();
    await page.waitForTimeout(1000);
    console.log("8. Switched to Compare Schools tab");
  }

  // Select NCCCS from "from"
  const selects2 = await page.$$("select");
  for (const sel of selects2) {
    const hasNccc = await sel.$("option[value='NCCC']");
    if (hasNccc) {
      await sel.selectOption("NCCC");
      break;
    }
  }
  await page.waitForTimeout(500);

  // Check 3 "to" checkboxes (App State, ECU, UNC-CH)
  const checkboxes = await page.$$("input[type='checkbox'][name*='to']");
  console.log(`   Found ${checkboxes.length} 'to' checkboxes`);
  let checked = 0;
  for (const cb of checkboxes) {
    if (checked >= 3) break;
    const val = await cb.getAttribute("value");
    if (val === "002906" || val === "002923" || val === "002974") {
      await cb.check();
      console.log(`   Checked: ${val}`);
      checked++;
    }
  }

  // Submit compare search
  captured.length = 0;
  const compareBtn = await page.$(".search-btn, button[type='submit']");
  if (compareBtn) {
    await compareBtn.click();
    console.log("9. Submitted compare search. Waiting...");
    await page.waitForTimeout(8000);
  }

  console.log(`\n10. Captured ${captured.length} XHR requests:`);
  for (const req of captured) {
    console.log(`\n   ${req.method} ${req.url} → ${req.status}`);
    if (req.postData) console.log(`   POST data: ${req.postData}`);
    if (req.body) console.log(req.body.slice(0, 3000));
  }

  console.log("\n11. Compare results URL:", page.url());

  // Check for result tables
  const compareTables = await page.$$eval("table", (tables) =>
    tables.map((t) => ({
      rows: t.rows.length,
      firstRowCells: Array.from(t.rows[0]?.cells || []).map((c) => c.textContent?.trim()),
      sampleRow: t.rows[1] ? Array.from(t.rows[1].cells).map((c) => c.textContent?.trim()) : [],
      html: t.outerHTML.slice(0, 2000),
    }))
  );
  compareTables.forEach((t, i) => {
    console.log(`\n   Table ${i}: ${t.rows} rows`);
    console.log(`   Headers: ${JSON.stringify(t.firstRowCells)}`);
    console.log(`   Sample row: ${JSON.stringify(t.sampleRow)}`);
  });

  await browser.close();
  console.log("\n=== Discovery complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
