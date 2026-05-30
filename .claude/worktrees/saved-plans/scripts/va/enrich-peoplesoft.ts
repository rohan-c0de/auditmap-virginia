/**
 * enrich-peoplesoft.ts
 *
 * Enriches existing course JSON files with instructor name and open/closed status
 * scraped from PeopleSoft's VCCS Class Search (ps-sis.vccs.edu).
 *
 * Discovered PS page structure (from probing NV280):
 *   - Subject dropdown: SELECT#VX_CLSRCH_WRK2_SUBJECT
 *   - Catalog number:   INPUT#VX_CLSRCH_WRK2_CATALOG_NBR
 *   - Search button:    A#VX_CLSRCH_WRK2_SEARCH_BTN
 *   - Result cards:     DIV#win0divVX_RSLT_NAV_WK_GROUPBUTTON$N
 *     - Title:          DIV#win0divVX_RSLT_NAV_WK_HTMLAREA$N     "ENG 111: College Composition I"
 *     - Status:         DIV#win0divVX_RSLT_NAV_WK_HTMLAREA1$207$$N  "Lecture (3.00 units) Open"
 *     - Section/CRN:    DIV#win0divVX_RSLT_NAV_WK_HTMLAREA2$N   "Section 001A / Class Nbr 75178 / ..."
 *     - Times:          DIV#win0divVX_RSLT_NAV_WK_HTMLAREA3$N
 *     - Dates:          DIV#win0divVX_RSLT_NAV_WK_HTMLAREA4$N
 *     - Instructor+Loc: DIV#win0divVX_RSLT_NAV_WK_HTMLAREA5$N   "S MonroeLocation: ALEXANDRIA ..."
 *   - Max 250 results per search (modal warning if exceeded)
 *   - Pagination: 50 per page, next page via VX_RSLT_NAV_WK_SEARCH_CONDITION2 link
 *
 * Usage:
 *   npx tsx scripts/enrich-peoplesoft.ts                     # all colleges
 *   npx tsx scripts/enrich-peoplesoft.ts --slug nova         # single college
 *   npx tsx scripts/enrich-peoplesoft.ts --dry-run           # preview, don't write
 *   npx tsx scripts/enrich-peoplesoft.ts --slug gcc --subject ENG  # one subject
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PS_BASE = "https://ps-sis.vccs.edu";

// Term name → PS term code + file code (mirrors scrape-peoplesoft.ts).
// VCCS PeopleSoft term IDs (2262, 2263, ...) are opaque internal IDs assigned
// by VCCS; they are not derivable from the calendar. This mapping table is
// the authoritative source — extend it when VCCS publishes new term IDs.
const PS_TERM_MAP: Record<string, { code: string; file: string }> = {
  "Spring 2026": { code: "2262", file: "2026SP" }, // term-hardcode-allowed: opaque VCCS PS term ID
  "Summer 2026": { code: "2263", file: "2026SU" }, // term-hardcode-allowed: opaque VCCS PS term ID
  "Fall 2026":   { code: "2264", file: "2026FA" }, // term-hardcode-allowed: opaque VCCS PS term ID
  "Spring 2027": { code: "2272", file: "2027SP" }, // term-hardcode-allowed: opaque VCCS PS term ID
};

// Accept --term "Summer 2026" (human-readable, matching scrape-peoplesoft.ts)
// or legacy --term-code= / --json-term= flags
const termNameArg = process.argv.find(a => a === "--term")
  ? process.argv[process.argv.indexOf("--term") + 1]?.split(",")[0]?.trim()
  : null;
const legacyTermCode = process.argv.find(a => a.startsWith("--term-code="))?.split("=")[1];
const legacyJsonTerm = process.argv.find(a => a.startsWith("--json-term="))?.split("=")[1];

const resolved = termNameArg ? PS_TERM_MAP[termNameArg] : null;
const TERM_CODE = resolved?.code ?? legacyTermCode ?? "2262";
const JSON_TERM = resolved?.file ?? legacyJsonTerm ?? "2026SP";
const NAV_TIMEOUT = 30_000;
const SEARCH_WAIT = 20_000; // max wait for search results
const INTER_SEARCH_DELAY = 2000; // ms between subject searches
const MAX_RETRIES = 2;

const DATA_DIR = path.join(process.cwd(), "data", "va", "courses");
const PS_DISCOVERY_DIR = path.join(process.cwd(), "data", "va", "ps-discovery");

// Cap drift dumps per run so a multi-college mismatch doesn't fill the
// artifact with hundreds of near-identical HTML pages. See issue #98.
let driftDumpsRemaining = 5;

// Load institution codes
const PS_CODES: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "va", "peoplesoft-codes.json"), "utf-8")
);
delete (PS_CODES as Record<string, unknown>)["_comment"];
delete (PS_CODES as Record<string, unknown>)["_url_pattern"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface PSSection {
  classNbr: string; // maps to CRN
  instructor: string | null;
  isOpen: boolean;
}

interface EnrichmentStats {
  slug: string;
  totalSections: number;
  matchedSections: number;
  enrichedInstructor: number;
  enrichedStatus: number;
  subjectsSearched: number;
  errors: string[];
  timeTakenMs: number;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): {
  slugs: string[];
  dryRun: boolean;
  subject: string | null;
  headed: boolean;
} {
  const args = process.argv.slice(2);
  let slugs: string[] = Object.keys(PS_CODES);
  let dryRun = false;
  let subject: string | null = null;
  let headed = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) {
      slugs = [args[i + 1]];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--subject" && args[i + 1]) {
      subject = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--headed") {
      headed = true;
    }
  }

  for (const s of slugs) {
    if (!PS_CODES[s]) {
      console.error(`Unknown slug: ${s}. Available: ${Object.keys(PS_CODES).join(", ")}`);
      process.exit(1);
    }
  }

  return { slugs, dryRun, subject, headed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Save the current PeopleSoft page HTML + a screenshot to data/va/ps-discovery/
 * so a human can inspect the new DOM scheme after the workflow uploads
 * `data/va/` as an artifact. Capped per run via `driftDumpsRemaining`.
 *
 * Used when extractPageSections() returns sections whose CRNs were caught by
 * the body-text regex but whose instructor DOM lookups all returned null —
 * that combination means PeopleSoft renamed the result-card element IDs and
 * the position-indexed `HTMLAREA5$N` selectors no longer match. See issue #98.
 */
async function dumpDriftEvidence(
  page: Page,
  context: { college: string; subject: string; matchCount: number }
): Promise<void> {
  if (driftDumpsRemaining <= 0) return;
  driftDumpsRemaining--;

  if (!fs.existsSync(PS_DISCOVERY_DIR)) {
    fs.mkdirSync(PS_DISCOVERY_DIR, { recursive: true });
  }

  const stem = `enrich-drift-${context.college}-${context.subject}-${Date.now()}`;
  try {
    fs.writeFileSync(
      path.join(PS_DISCOVERY_DIR, `${stem}.html`),
      await page.content()
    );
    await page.screenshot({
      path: path.join(PS_DISCOVERY_DIR, `${stem}.png`),
      fullPage: true,
    });
    console.error(
      `   🚨 SELECTOR DRIFT: ${context.college}/${context.subject} — ` +
        `extracted ${context.matchCount} CRN(s) but 0 had instructor info. ` +
        `Saved evidence to data/va/ps-discovery/${stem}.{html,png}`
    );
  } catch (e) {
    console.error(`   ⚠ Failed to save drift evidence: ${(e as Error).message}`);
  }
}

function readCourseJson(slug: string): CourseSection[] {
  const filePath = path.join(DATA_DIR, slug, `${JSON_TERM}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`JSON not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeCourseJson(slug: string, sections: CourseSection[]): void {
  const filePath = path.join(DATA_DIR, slug, `${JSON_TERM}.json`);
  fs.writeFileSync(filePath, JSON.stringify(sections, null, 2) + "\n");
}

function getUniqueSubjects(sections: CourseSection[]): string[] {
  const subjects = new Set(sections.map((s) => s.course_prefix));
  return Array.from(subjects).sort();
}

/**
 * Get the PS subject label for a given prefix by checking the dropdown options.
 * PS uses labels like "ENG-English", "MTH-Mathematics", etc.
 * Returns the label to select, or null if not found.
 */
async function findSubjectLabel(page: Page, prefix: string): Promise<string | null> {
  const labels: string[] = await page.evaluate((pfx: string) => {
    const select = document.getElementById("VX_CLSRCH_WRK2_SUBJECT") as HTMLSelectElement | null;
    if (!select) return [];
    const matching: string[] = [];
    for (const opt of select.options) {
      if (opt.text.startsWith(pfx + "-") || opt.text.startsWith(pfx + " -")) {
        matching.push(opt.text);
      }
    }
    return matching;
  }, prefix);

  return labels.length > 0 ? labels[0] : null;
}

// ---------------------------------------------------------------------------
// PS page interaction (using discovered selectors)
// ---------------------------------------------------------------------------

function buildBrowseUrl(institutionCode: string): string {
  return `${PS_BASE}/psc/S92GUEST/EMPLOYEE/SA/c/VX_CUSTOM_SR.VX_SSR_CLSRCH_FL.GBL?COLLEGE=${institutionCode}&TERM=${TERM_CODE}`;
}

async function navigateToBrowse(page: Page, institutionCode: string): Promise<boolean> {
  try {
    await page.goto(buildBrowseUrl(institutionCode), {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT,
    });
    await sleep(1500);
    return true;
  } catch (err) {
    console.error(`    ⚠ Nav failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Dismiss the "exceeds 250 classes" modal if it appears.
 * PS shows a modal with an OK button when results exceed the limit.
 */
async function dismissModal(page: Page): Promise<void> {
  try {
    // Check for modal mask
    const hasModal = await page.evaluate(() => {
      const mask = document.getElementById("pt_modalMask");
      return mask && window.getComputedStyle(mask).display !== "none";
    });

    if (hasModal) {
      // Click the OK button in the modal
      await page.evaluate(() => {
        // PS modal OK button typically has id #ADMN_S201801_WRK_GROUPBOX$0 or similar
        // But safer to find it by text
        const buttons = document.querySelectorAll("a, button, input[type='button']");
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text === "OK" || text === "Ok") {
            (btn as HTMLElement).click();
            return;
          }
        }
        // Fallback: click the modal mask itself
        const mask = document.getElementById("pt_modalMask");
        if (mask) mask.click();
      });
      await sleep(1000);
    }
  } catch {
    // Ignore modal dismiss errors
  }
}

/**
 * Search for a subject by selecting it from the dropdown and clicking Search.
 * Returns true if results loaded.
 */
async function searchSubject(page: Page, subjectLabel: string): Promise<boolean> {
  try {
    // Select subject from dropdown
    await page.selectOption("#VX_CLSRCH_WRK2_SUBJECT", { label: subjectLabel });
    await sleep(500);

    // Clear catalog number (ensure we get all courses for this subject)
    const catInput = page.locator("#VX_CLSRCH_WRK2_CATALOG_NBR");
    if (await catInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await catInput.clear();
    }

    // Click Search
    await page.click("#VX_CLSRCH_WRK2_SEARCH_BTN");

    // Wait for results to load (look for "Class Nbr" or "results" text)
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          text.includes("Class Nbr") ||
          text.includes("results") ||
          text.includes("No results") ||
          text.includes("no classes found") ||
          text.includes("exceeds the maximum")
        );
      },
      { timeout: SEARCH_WAIT }
    );

    await sleep(1500);

    // Dismiss the 250-limit modal if present
    await dismissModal(page);

    // Check for "no results"
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (bodyText.includes("No results") || bodyText.includes("no classes found")) {
      return false;
    }

    return bodyText.includes("Class Nbr");
  } catch (err) {
    console.error(`    ⚠ Search failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Extract all section data from the current page of PS results.
 * Uses the discovered VCCS PS Fluid UI card structure.
 *
 * Each result card has:
 *   HTMLAREA2$N → "Section 001A / Class Nbr 75178 / Regular Academic Session"
 *   HTMLAREA1$...$N → "Lecture (3.00 units) Open|Closed"
 *   HTMLAREA5$N → "S MonroeLocation: CAMPUS ..."
 */
async function extractPageSections(page: Page): Promise<PSSection[]> {
  return page.evaluate(() => {
    const sections: { classNbr: string; instructor: string | null; isOpen: boolean }[] = [];

    // Get all visible text as a single block and parse it
    // Each section follows a predictable pattern in the PS card layout
    const bodyText = document.body?.innerText || "";

    // Extract using regex on the full text — more reliable than DOM traversal
    // Pattern: "Section XXX / Class Nbr NNNNN / ..." appears for each section
    const classNbrPattern = /Class Nbr (\d+)/g;
    const classNbrs: string[] = [];
    let match;
    while ((match = classNbrPattern.exec(bodyText)) !== null) {
      classNbrs.push(match[1]);
    }

    // For each class number, find the surrounding context to extract instructor and status
    // We rely on the DOM structure: HTMLAREA$N cards indexed 0..N-1
    for (let i = 0; i < classNbrs.length; i++) {
      const crn = classNbrs[i];

      // Find status: look for the HTMLAREA1 div for this index
      // These contain text like "Lecture (3.00 units) Open" or "Closed"
      let isOpen = true; // default to open
      const statusDivs = document.querySelectorAll(`[id*="VX_RSLT_NAV_WK_HTMLAREA1"]`);
      for (const div of statusDivs) {
        const id = div.id;
        // Match the index — id ends with $$N where N = i
        if (id.endsWith(`$$${i}`) || id.endsWith(`$${i}`)) {
          const text = div.textContent || "";
          if (text.includes("Closed")) isOpen = false;
          break;
        }
      }

      // Fallback status check: search near the Class Nbr text
      if (isOpen) {
        // Check a window around this CRN in the full text
        const crnIdx = bodyText.indexOf(`Class Nbr ${crn}`);
        if (crnIdx !== -1) {
          const context = bodyText.substring(Math.max(0, crnIdx - 200), crnIdx);
          if (context.includes("Closed")) isOpen = false;
        }
      }

      // Find instructor from HTMLAREA5$N
      let instructor: string | null = null;
      const instrDiv = document.querySelector(
        `[id="win0divVX_RSLT_NAV_WK_HTMLAREA5$${i}"]`
      ) as HTMLElement | null;
      if (instrDiv) {
        const text = instrDiv.textContent || "";
        // Format: "S MonroeLocation: CAMPUS..." or just "Location: ..."
        const locIdx = text.indexOf("Location:");
        if (locIdx > 0) {
          instructor = text.substring(0, locIdx).trim() || null;
        } else if (!text.includes("Location:") && text.trim()) {
          instructor = text.trim() || null;
        }
      }

      // Clean up instructor — remove "Staff" or empty values
      if (instructor && (instructor.toLowerCase() === "staff" || instructor === "-" || instructor === "")) {
        instructor = null;
      }

      sections.push({ classNbr: crn, instructor, isOpen });
    }

    return sections;
  });
}

/**
 * Navigate to the next page of results.
 * PS uses VX_RSLT_NAV_WK_SEARCH_CONDITION2 link for "next page".
 */
async function goToNextPage(page: Page): Promise<boolean> {
  try {
    // Check if there's a next page indicator
    // The pagination shows "1 - 50" of N, with forward arrow
    const nextLink = page.locator("#VX_RSLT_NAV_WK_SEARCH_CONDITION2");
    if (await nextLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextLink.click({ force: true }).catch(async () => {
        // If regular click fails due to overlay, use JS click
        await page.evaluate(() => {
          const el = document.getElementById("VX_RSLT_NAV_WK_SEARCH_CONDITION2");
          if (el) el.click();
        });
      });

      // Wait for new results
      await sleep(3000);
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText || "";
          return text.includes("Class Nbr");
        },
        { timeout: 15000 }
      ).catch(() => {});

      await sleep(1000);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// College-level enrichment
// ---------------------------------------------------------------------------

async function enrichCollege(
  browser: Browser,
  slug: string,
  subjectFilter: string | null,
  dryRun: boolean
): Promise<EnrichmentStats> {
  const startTime = Date.now();
  const stats: EnrichmentStats = {
    slug,
    totalSections: 0,
    matchedSections: 0,
    enrichedInstructor: 0,
    enrichedStatus: 0,
    subjectsSearched: 0,
    errors: [],
    timeTakenMs: 0,
  };

  const institutionCode = PS_CODES[slug];
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📚 Enriching: ${slug} (${institutionCode})`);

  // Read existing JSON
  let sections: CourseSection[];
  try {
    sections = readCourseJson(slug);
    stats.totalSections = sections.length;
    console.log(`   ${sections.length} sections in JSON`);
  } catch (err) {
    const msg = `Failed to read JSON: ${(err as Error).message}`;
    stats.errors.push(msg);
    console.error(`   ❌ ${msg}`);
    stats.timeTakenMs = Date.now() - startTime;
    return stats;
  }

  // Get unique subjects to search
  const subjects = subjectFilter ? [subjectFilter] : getUniqueSubjects(sections);
  console.log(`   ${subjects.length} subjects to search`);

  // Build CRN lookup for fast matching
  const crnToIndex = new Map<string, number>();
  sections.forEach((s, i) => crnToIndex.set(s.crn, i));

  // Create a fresh browser context
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    // Navigate to PS class browse page
    const navOk = await navigateToBrowse(page, institutionCode);
    if (!navOk) {
      stats.errors.push("Failed to navigate to PS browse page");
      await context.close();
      stats.timeTakenMs = Date.now() - startTime;
      return stats;
    }
    console.log(`   ✅ PS page loaded`);

    // Search subject by subject
    for (const subject of subjects) {
      stats.subjectsSearched++;
      process.stdout.write(`   🔎 ${subject}`);

      // Find the PS dropdown label for this subject prefix
      const label = await findSubjectLabel(page, subject);
      if (!label) {
        console.log(` — not in PS dropdown, skipping`);
        continue;
      }

      let retries = 0;
      let searchOk = false;

      while (retries <= MAX_RETRIES && !searchOk) {
        searchOk = await searchSubject(page, label);
        if (!searchOk) {
          retries++;
          if (retries <= MAX_RETRIES) {
            process.stdout.write(` [retry ${retries}]`);
            await navigateToBrowse(page, institutionCode);
          }
        }
      }

      if (!searchOk) {
        console.log(` — no results`);
        // Navigate back for next subject
        await navigateToBrowse(page, institutionCode);
        await sleep(500);
        continue;
      }

      // Extract from all pages
      let pageNum = 0;
      let totalExtracted = 0;
      let pageInstructorsFound = 0;

      do {
        pageNum++;
        const psSections = await extractPageSections(page);

        for (const ps of psSections) {
          if (ps.instructor) pageInstructorsFound++;

          const idx = crnToIndex.get(ps.classNbr);
          if (idx === undefined) continue;

          stats.matchedSections++;

          if (ps.instructor && !sections[idx].instructor) {
            sections[idx].instructor = ps.instructor;
            stats.enrichedInstructor++;
          }

          // Use open/closed status: Open → seats_open = 1, Closed → seats_open = 0
          if (sections[idx].seats_open === null) {
            sections[idx].seats_open = ps.isOpen ? 1 : 0;
            stats.enrichedStatus++;
          }
        }

        // Drift guard: psSections came from regex on body text, so a non-zero
        // length means PS rendered real results. If NONE of those rows pulled
        // an instructor name from the HTMLAREA5 lookup, the position-indexed
        // selectors are broken (issue #98). Dump evidence and warn — we don't
        // throw here because enrich is secondary; let the run complete so the
        // summary JSON captures the warning across all colleges.
        if (psSections.length > 0 && pageInstructorsFound === 0) {
          await dumpDriftEvidence(page, {
            college: slug,
            subject,
            matchCount: psSections.length,
          });
          stats.errors.push(
            `Selector drift on ${subject} page ${pageNum}: ${psSections.length} CRNs extracted, 0 instructors`
          );
        }

        totalExtracted += psSections.length;
      } while (await goToNextPage(page));

      console.log(` → ${totalExtracted} sections (${pageNum} pages)`);

      await sleep(INTER_SEARCH_DELAY);

      // Navigate back to browse page for next subject
      await navigateToBrowse(page, institutionCode);
      await sleep(500);
    }
  } catch (err) {
    const msg = `Runtime error: ${(err as Error).message}`;
    stats.errors.push(msg);
    console.error(`\n   ❌ ${msg}`);
  } finally {
    await context.close();
  }

  // Write enriched JSON
  if (!dryRun) {
    writeCourseJson(slug, sections);
    console.log(`   💾 JSON updated`);
  } else {
    console.log(`   🏷️  DRY RUN — no files written`);
  }

  stats.timeTakenMs = Date.now() - startTime;
  console.log(
    `   📊 ${stats.matchedSections} matched | ${stats.enrichedInstructor} instructors | ${stats.enrichedStatus} statuses | ${(stats.timeTakenMs / 1000).toFixed(1)}s`
  );
  if (stats.errors.length > 0) {
    console.log(`   ⚠ ${stats.errors.length} errors`);
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { slugs, dryRun, subject, headed } = parseArgs();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 PeopleSoft Enrichment`);
  console.log(`   Colleges: ${slugs.length} | Term: ${TERM_CODE} | Dry run: ${dryRun}`);
  if (subject) console.log(`   Subject filter: ${subject}`);
  console.log(`${"=".repeat(60)}`);

  const browser = await chromium.launch({ headless: !headed });
  const allStats: EnrichmentStats[] = [];

  for (const slug of slugs) {
    try {
      const stats = await enrichCollege(browser, slug, subject, dryRun);
      allStats.push(stats);
    } catch (err) {
      console.error(`\n❌ Fatal error for ${slug}: ${(err as Error).message}`);
      allStats.push({
        slug,
        totalSections: 0,
        matchedSections: 0,
        enrichedInstructor: 0,
        enrichedStatus: 0,
        subjectsSearched: 0,
        errors: [(err as Error).message],
        timeTakenMs: 0,
      });
    }
  }

  await browser.close();

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 ENRICHMENT SUMMARY");
  console.log(`${"=".repeat(60)}`);

  let totalMatched = 0;
  let totalInstructors = 0;
  let totalStatuses = 0;
  let totalErrors = 0;

  for (const s of allStats) {
    const status = s.errors.length > 0 ? "⚠" : "✅";
    console.log(
      `${status} ${s.slug.padEnd(15)} ${String(s.matchedSections).padStart(5)} matched | ` +
        `${String(s.enrichedInstructor).padStart(4)} instr | ` +
        `${String(s.enrichedStatus).padStart(4)} status | ` +
        `${(s.timeTakenMs / 1000).toFixed(1)}s`
    );
    totalMatched += s.matchedSections;
    totalInstructors += s.enrichedInstructor;
    totalStatuses += s.enrichedStatus;
    totalErrors += s.errors.length;
  }

  console.log(`${"─".repeat(60)}`);
  console.log(
    `TOTAL: ${totalMatched} matched | ${totalInstructors} instructors | ${totalStatuses} statuses | ${totalErrors} errors`
  );
  console.log(`${"=".repeat(60)}\n`);

  // Write summary
  const summaryPath = path.join(process.cwd(), "data", "va", "ps-enrichment-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        term: TERM_CODE,
        dryRun,
        stats: allStats,
        totals: { matched: totalMatched, instructors: totalInstructors, statuses: totalStatuses, errors: totalErrors },
      },
      null,
      2
    ) + "\n"
  );
  console.log(`📝 Summary saved: ${summaryPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
