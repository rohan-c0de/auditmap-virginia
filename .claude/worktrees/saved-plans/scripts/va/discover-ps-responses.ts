/**
 * discover-ps-responses.ts
 *
 * Discovery script that launches a HEADED browser to explore PeopleSoft's
 * class search at ps-sis.vccs.edu. Use this to observe the page structure,
 * identify CSS selectors, and understand the search flow before building
 * the main enrichment script.
 *
 * Usage:
 *   npx tsx scripts/discover-ps-responses.ts                 # defaults to nova
 *   npx tsx scripts/discover-ps-responses.ts --slug gcc      # specific college
 *   npx tsx scripts/discover-ps-responses.ts --slug nova --subject ENG
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PS_BASE = "https://ps-sis.vccs.edu";
const TERM_CODE = "2262"; // Spring 2026
const NAV_TIMEOUT = 30_000;
const SCREENSHOT_DIR = path.join(process.cwd(), "data", "va", "ps-discovery");

// Load institution codes
const PS_CODES_RAW: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "va", "peoplesoft-codes.json"), "utf-8")
);
// Remove metadata keys
const PS_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(PS_CODES_RAW).filter(([k]) => !k.startsWith("_"))
);

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { slug: string; subject: string | null } {
  const args = process.argv.slice(2);
  let slug = "nova";
  let subject: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) {
      slug = args[i + 1];
      i++;
    } else if (args[i] === "--subject" && args[i + 1]) {
      subject = args[i + 1].toUpperCase();
      i++;
    }
  }

  if (!PS_CODES[slug]) {
    console.error(`Unknown slug: ${slug}. Available: ${Object.keys(PS_CODES).join(", ")}`);
    process.exit(1);
  }

  return { slug, subject };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { slug, subject } = parseArgs();
  const institutionCode = PS_CODES[slug];

  console.log(`\n🔍 PeopleSoft Discovery for: ${slug} (${institutionCode})`);
  console.log(`   Term: ${TERM_CODE} | Subject: ${subject || "(browse manually)"}`);

  // Ensure screenshot directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Launch HEADED browser so you can observe
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500, // slow down so you can see what's happening
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  // Log all network responses to help find API endpoints
  const apiResponses: { url: string; status: number; contentType: string }[] = [];
  page.on("response", (response) => {
    const url = response.url();
    const ct = response.headers()["content-type"] || "";
    if (
      url.includes("IScript") ||
      url.includes("ICAction") ||
      ct.includes("json") ||
      ct.includes("html")
    ) {
      apiResponses.push({
        url: url.substring(0, 200),
        status: response.status(),
        contentType: ct.substring(0, 80),
      });
    }
  });

  try {
    // Step 1: Navigate to the PeopleSoft class browse page
    const browseUrl = `${PS_BASE}/psc/S92GUEST/EMPLOYEE/SA/c/VX_CUSTOM_SR.VX_SSR_CLSRCH_FL.GBL?COLLEGE=${institutionCode}&TERM=${TERM_CODE}`;
    console.log(`\n📌 Navigating to: ${browseUrl}`);

    await page.goto(browseUrl, {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT,
    });

    // Take initial screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${slug}-01-landing.png`),
      fullPage: true,
    });
    console.log(`   📸 Screenshot saved: ${slug}-01-landing.png`);

    // Step 2: Log page title and key elements
    const title = await page.title();
    console.log(`   Page title: "${title}"`);

    // Look for search inputs
    const searchInputs = await page.locator("input[type='text'], input[type='search']").all();
    console.log(`   Found ${searchInputs.length} text/search inputs`);
    for (const input of searchInputs) {
      const id = await input.getAttribute("id");
      const name = await input.getAttribute("name");
      const placeholder = await input.getAttribute("placeholder");
      console.log(`     - input#${id} name="${name}" placeholder="${placeholder}"`);
    }

    // Look for dropdowns/selects
    const selects = await page.locator("select").all();
    console.log(`   Found ${selects.length} select elements`);
    for (const sel of selects) {
      const id = await sel.getAttribute("id");
      const name = await sel.getAttribute("name");
      console.log(`     - select#${id} name="${name}"`);
    }

    // Look for links/buttons that might be subject navigation
    const subjectLinks = await page.locator("a[data-subject], a[class*='subject'], a[class*='catalog']").all();
    console.log(`   Found ${subjectLinks.length} subject-like links`);

    // Step 3: If subject specified, try searching
    if (subject) {
      console.log(`\n🔎 Attempting to search for subject: ${subject}`);

      // Try common search patterns
      const searchBox = page.locator(
        "input[type='search'], input[placeholder*='search' i], input[placeholder*='subject' i], input[id*='search' i], input[name*='search' i]"
      ).first();

      if (await searchBox.isVisible().catch(() => false)) {
        await searchBox.fill(subject);
        await searchBox.press("Enter");
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${slug}-02-search-${subject}.png`),
          fullPage: true,
        });
        console.log(`   📸 Screenshot saved: ${slug}-02-search-${subject}.png`);

        // Look for result rows/cards
        const resultRows = await page.locator("tr, .class-card, .section-row, [class*='result']").all();
        console.log(`   Found ${resultRows.length} potential result elements`);
      } else {
        console.log("   ⚠ No search input found — check screenshots and page structure manually");
      }
    }

    // Step 4: Dump page structure hints
    console.log("\n📋 Page structure discovery:");

    // Check for iframe (PeopleSoft often uses iframes)
    const iframes = await page.locator("iframe").all();
    console.log(`   Iframes: ${iframes.length}`);
    for (const iframe of iframes) {
      const src = await iframe.getAttribute("src");
      const id = await iframe.getAttribute("id");
      console.log(`     - iframe#${id} src="${src?.substring(0, 100)}"`);
    }

    // Check for common PeopleSoft elements
    const psElements = [
      { sel: "#ptifrmtgtframe", desc: "PS target frame" },
      { sel: "#ptModFrame", desc: "PS modal frame" },
      { sel: ".ps_box-group", desc: "PS box group" },
      { sel: "[id*='CLASS_TBL']", desc: "CLASS_TBL elements" },
      { sel: "[id*='INSTRUCTOR']", desc: "INSTRUCTOR elements" },
      { sel: "[id*='ENRL_CAP']", desc: "Enrollment capacity elements" },
      { sel: "[id*='ENRL_TOT']", desc: "Enrollment total elements" },
      { sel: "[id*='CLASS_SECTION']", desc: "Class section elements" },
      { sel: "[id*='CRN']", desc: "CRN elements" },
      { sel: ".psc_backcolor", desc: "PS calendar/schedule" },
    ];

    for (const { sel, desc } of psElements) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        console.log(`   ✅ ${desc}: ${count} found (selector: ${sel})`);
      }
    }

    // Step 5: Dump captured API responses
    console.log(`\n📡 Captured ${apiResponses.length} relevant network responses:`);
    for (const resp of apiResponses.slice(0, 20)) {
      console.log(`   [${resp.status}] ${resp.contentType} — ${resp.url}`);
    }

    // Step 6: Extract full HTML for offline analysis
    const html = await page.content();
    const htmlPath = path.join(SCREENSHOT_DIR, `${slug}-page.html`);
    fs.writeFileSync(htmlPath, html);
    console.log(`\n💾 Full HTML saved: ${htmlPath} (${(html.length / 1024).toFixed(0)} KB)`);

    // Keep browser open for manual exploration
    console.log("\n🖥️  Browser is open for manual exploration.");
    console.log("   Navigate around, inspect elements, then close the browser window to exit.");
    console.log("   Press Ctrl+C to force-quit.\n");

    // Wait for browser to close
    await new Promise<void>((resolve) => {
      browser.on("disconnected", () => resolve());
    });
  } catch (err) {
    console.error("Error:", (err as Error).message);

    // Save error screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${slug}-error.png`),
      fullPage: true,
    }).catch(() => {});

    await browser.close();
    process.exit(1);
  }

  console.log("✅ Discovery complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
