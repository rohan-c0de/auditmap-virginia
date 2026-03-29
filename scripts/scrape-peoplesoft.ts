/**
 * scrape-peoplesoft.ts
 *
 * Full PeopleSoft scraper — creates complete course data for any VCCS term.
 * Unlike enrich-peoplesoft.ts (which updates existing data), this builds
 * CourseSection JSON from scratch by extracting all fields from PS result cards.
 *
 * Usage:
 *   npx tsx scripts/scrape-peoplesoft.ts --term "Summer 2026"              # all colleges
 *   npx tsx scripts/scrape-peoplesoft.ts --term "Summer 2026" --slug nova  # single college
 *   npx tsx scripts/scrape-peoplesoft.ts --term "Fall 2026" --headed       # visible browser
 *   npx tsx scripts/scrape-peoplesoft.ts --term "Summer 2026" --slug nova --subject ENG
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PS_BASE = "https://ps-sis.vccs.edu";
const NAV_TIMEOUT = 30_000;
const SEARCH_WAIT = 20_000;
const INTER_SEARCH_DELAY = 2000;
const MAX_RETRIES = 2;
const DATA_DIR = path.join(process.cwd(), "data", "courses");

// Term name → PS term code mapping
const TERM_CODES: Record<string, string> = {
  "Spring 2026": "2262",
  "Summer 2026": "2263",
  "Fall 2026": "2264",
  "Spring 2027": "2272",
};

// Term name → file code
const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026": "2026FA",
  "Spring 2027": "2027SP",
};

// Load institution codes
const PS_CODES: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "peoplesoft-codes.json"), "utf-8")
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

interface RawCard {
  title: string;
  status: string;
  sectionCrn: string;
  times: string;
  dates: string;
  instrLoc: string;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let slugs: string[] = Object.keys(PS_CODES);
  let termName = "";
  let subject: string | null = null;
  let headed = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termName = args[i + 1];
      i++;
    } else if (args[i] === "--slug" && args[i + 1]) {
      slugs = [args[i + 1]];
      i++;
    } else if (args[i] === "--subject" && args[i + 1]) {
      subject = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--headed") {
      headed = true;
    }
  }

  if (!termName) {
    console.error("Error: --term is required. Example: --term \"Summer 2026\"");
    console.error("Available terms:", Object.keys(TERM_CODES).join(", "));
    process.exit(1);
  }

  const psTermCode = TERM_CODES[termName];
  const fileTermCode = TERM_FILE_CODES[termName];
  if (!psTermCode || !fileTermCode) {
    console.error(`Unknown term: "${termName}". Available:`, Object.keys(TERM_CODES).join(", "));
    process.exit(1);
  }

  for (const s of slugs) {
    if (!PS_CODES[s]) {
      console.error(`Unknown slug: ${s}. Available: ${Object.keys(PS_CODES).join(", ")}`);
      process.exit(1);
    }
  }

  return { slugs, termName, psTermCode, fileTermCode, subject, headed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// PS page interaction
// ---------------------------------------------------------------------------

function buildUrl(institutionCode: string, termCode: string): string {
  return `${PS_BASE}/psc/S92GUEST/EMPLOYEE/SA/c/VX_CUSTOM_SR.VX_SSR_CLSRCH_FL.GBL?COLLEGE=${institutionCode}&TERM=${termCode}`;
}

async function navigateToBrowse(page: Page, institutionCode: string, termCode: string): Promise<boolean> {
  try {
    await page.goto(buildUrl(institutionCode, termCode), {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT,
    });
    await sleep(2000);
    const hasDropdown = await page.locator("#VX_CLSRCH_WRK2_SUBJECT").isVisible({ timeout: 10000 }).catch(() => false);
    return hasDropdown;
  } catch (err) {
    console.error(`    ⚠ Nav failed: ${(err as Error).message}`);
    return false;
  }
}

async function dismissModal(page: Page): Promise<void> {
  try {
    const hasModal = await page.evaluate(() => {
      const mask = document.getElementById("pt_modalMask");
      return mask && window.getComputedStyle(mask).display !== "none";
    });
    if (hasModal) {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll("a, button, input[type='button']");
        for (const btn of buttons) {
          if (btn.textContent?.trim() === "OK" || btn.textContent?.trim() === "Ok") {
            (btn as HTMLElement).click();
            return;
          }
        }
        const mask = document.getElementById("pt_modalMask");
        if (mask) mask.click();
      });
      await sleep(1000);
    }
  } catch {
    // ignore
  }
}

async function getSubjectLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = document.getElementById("VX_CLSRCH_WRK2_SUBJECT") as HTMLSelectElement | null;
    if (!sel) return [];
    const labels: string[] = [];
    for (const opt of sel.options) {
      if (opt.value && opt.text.trim() && opt.value !== " ") {
        labels.push(opt.text.trim());
      }
    }
    return labels;
  });
}

async function searchSubject(page: Page, subjectLabel: string): Promise<boolean> {
  try {
    await page.selectOption("#VX_CLSRCH_WRK2_SUBJECT", { label: subjectLabel });
    await sleep(500);

    const catInput = page.locator("#VX_CLSRCH_WRK2_CATALOG_NBR");
    if (await catInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await catInput.clear();
    }

    await page.click("#VX_CLSRCH_WRK2_SEARCH_BTN");

    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          text.includes("Class Nbr") ||
          text.includes("No results") ||
          text.includes("no classes found") ||
          text.includes("exceeds the maximum")
        );
      },
      { timeout: SEARCH_WAIT }
    );

    await sleep(1500);
    await dismissModal(page);

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

// ---------------------------------------------------------------------------
// Card extraction — full fields
// ---------------------------------------------------------------------------

async function extractPageCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const cards: { title: string; status: string; sectionCrn: string; times: string; dates: string; instrLoc: string }[] = [];

    for (let i = 0; i < 250; i++) {
      const titleEl = document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA$${i}`) as HTMLElement | null;
      if (!titleEl) break;

      const title = titleEl.innerText?.trim() || "";
      if (!title) break;

      // Status — try multiple ID patterns
      let status = "";
      const statusCandidates = document.querySelectorAll(`[id*="VX_RSLT_NAV_WK_HTMLAREA1"]`);
      for (const el of statusCandidates) {
        if (el.id.endsWith(`$$${i}`) || el.id.endsWith(`$${i}`)) {
          status = (el as HTMLElement).innerText?.trim() || "";
          break;
        }
      }

      const sectionCrn = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA2$${i}`) as HTMLElement)?.innerText?.trim() || "";
      const times = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA3$${i}`) as HTMLElement)?.innerText?.trim() || "";
      const dates = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA4$${i}`) as HTMLElement)?.innerText?.trim() || "";
      const instrLoc = (document.getElementById(`win0divVX_RSLT_NAV_WK_HTMLAREA5$${i}`) as HTMLElement)?.innerText?.trim() || "";

      cards.push({ title, status, sectionCrn, times, dates, instrLoc });
    }

    return cards;
  });
}

async function goToNextPage(page: Page): Promise<boolean> {
  try {
    const nextLink = page.locator("#VX_RSLT_NAV_WK_SEARCH_CONDITION2");
    if (await nextLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextLink.click({ force: true }).catch(async () => {
        await page.evaluate(() => {
          const el = document.getElementById("VX_RSLT_NAV_WK_SEARCH_CONDITION2");
          if (el) el.click();
        });
      });

      await sleep(3000);
      await page.waitForFunction(
        () => (document.body?.innerText || "").includes("Class Nbr"),
        { timeout: 15000 }
      );
      await sleep(1000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parsing raw cards into CourseSection objects
// ---------------------------------------------------------------------------

function parseTitle(raw: string): { prefix: string; number: string; title: string } {
  // "ENG 111: College Composition I" or "ENG 111 - College Composition I"
  const m = raw.match(/^([A-Z]{2,4})\s+(\d{3}[A-Z]?)\s*[:\-–]\s*(.+)$/);
  if (m) return { prefix: m[1], number: m[2], title: m[3].trim() };
  // Fallback: just split on first space
  const parts = raw.split(/\s+/);
  return { prefix: parts[0] || "UNK", number: parts[1] || "000", title: parts.slice(2).join(" ") };
}

function parseStatus(raw: string): { credits: number; isOpen: boolean } {
  // "Lecture (3.00 units) Open" or "Lab (1.00 units) Closed"
  const creditsMatch = raw.match(/\((\d+(?:\.\d+)?)\s*units?\)/i);
  const credits = creditsMatch ? parseFloat(creditsMatch[1]) : 3;
  const isOpen = !raw.includes("Closed");
  return { credits: Math.round(credits), isOpen };
}

function parseCrn(raw: string): string {
  // "Section 001A / Class Nbr 75178 / Regular Academic Session"
  const m = raw.match(/Class Nbr\s+(\d+)/);
  return m ? m[1] : "";
}

function parseTimes(raw: string): { days: string; startTime: string; endTime: string } {
  // "M W : 9:00 AM-12:30 PM" or "Tu Th : 6:00 PM-7:45 PM" or "TBA" or empty
  if (!raw || raw === "TBA" || raw.toLowerCase().includes("tba")) {
    return { days: "", startTime: "", endTime: "" };
  }

  // Split on colon — left is days, right is times
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    return { days: "", startTime: "", endTime: "" };
  }

  const dayPart = raw.substring(0, colonIdx).trim();
  const timePart = raw.substring(colonIdx + 1).trim();

  // Parse days: "M W" → "MW", "Tu Th" → "TuTh", "M W F" → "MWF"
  const days = dayPart.replace(/\s+/g, "");

  // Parse times: "9:00 AM-12:30 PM" or "9:00AM - 12:30PM"
  const timeMatch = timePart.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (timeMatch) {
    return {
      days,
      startTime: timeMatch[1].replace(/\s+/g, " ").trim(),
      endTime: timeMatch[2].replace(/\s+/g, " ").trim(),
    };
  }

  return { days, startTime: "", endTime: "" };
}

function parseDates(raw: string): string {
  // "05/18/2026 - 06/29/2026" → "2026-05-18"
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return "";
}

function parseInstructorLocation(raw: string): { instructor: string | null; campus: string; location: string } {
  // "A Purugganan\nLocation: ALEXANDRIA TBA"
  // or "S Smith\nLocation: VIRTUAL-RT ZOOM"
  // or "Location: ANNANDALE TBA" (no instructor)

  let instructor: string | null = null;
  let campus = "";
  let location = "";

  const locIdx = raw.indexOf("Location:");
  if (locIdx >= 0) {
    const instrPart = raw.substring(0, locIdx).trim();
    const locPart = raw.substring(locIdx + "Location:".length).trim();

    if (instrPart && instrPart.toLowerCase() !== "staff" && instrPart !== "-") {
      instructor = instrPart.replace(/\n/g, " ").trim();
    }

    // Campus: first word of location (ALEXANDRIA, ANNANDALE, VIRTUAL-RT, etc.)
    location = locPart;
    campus = locPart.split(/\s+/)[0] || "";
    // Normalize campus name
    campus = campus.charAt(0).toUpperCase() + campus.slice(1).toLowerCase();
    campus = campus.replace(/-.*/, ""); // "Virtual-rt" → "Virtual"
  } else {
    // No "Location:" — treat whole thing as instructor
    const cleaned = raw.replace(/\n/g, " ").trim();
    if (cleaned && cleaned.toLowerCase() !== "staff" && cleaned !== "-") {
      instructor = cleaned;
    }
  }

  return { instructor, campus, location };
}

function determineMode(location: string, campus: string, times: string): string {
  const loc = (location + " " + campus).toLowerCase();
  if (loc.includes("virtual") && loc.includes("zoom")) return "zoom";
  if (loc.includes("virtual") || loc.includes("online")) return "online";
  if (loc.includes("hybrid")) return "hybrid";
  if (!times || times === "TBA") return "online"; // No meeting times usually means online
  return "in-person";
}

function rawCardToSection(
  card: RawCard,
  collegeCode: string,
  fileTermCode: string
): CourseSection | null {
  const crn = parseCrn(card.sectionCrn);
  if (!crn) return null;

  const { prefix, number, title } = parseTitle(card.title);
  const { credits, isOpen } = parseStatus(card.status);
  const { days, startTime, endTime } = parseTimes(card.times);
  const startDate = parseDates(card.dates);
  const { instructor, campus, location } = parseInstructorLocation(card.instrLoc);
  const mode = determineMode(location, campus, card.times);

  return {
    college_code: collegeCode,
    term: fileTermCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: startDate,
    location,
    campus,
    mode,
    instructor,
    seats_open: isOpen ? 1 : 0,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Main scrape logic per college
// ---------------------------------------------------------------------------

async function scrapeCollege(
  browser: Browser,
  slug: string,
  psTermCode: string,
  fileTermCode: string,
  subjectFilter: string | null
): Promise<CourseSection[]> {
  const institutionCode = PS_CODES[slug];
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const allSections: CourseSection[] = [];

  try {
    console.log(`\n📚 ${slug.toUpperCase()} (${institutionCode})`);

    // Navigate to browse page
    const loaded = await navigateToBrowse(page, institutionCode, psTermCode);
    if (!loaded) {
      console.log("  ✗ Could not load search page");
      return [];
    }

    // Get all available subjects
    let subjects = await getSubjectLabels(page);
    if (subjects.length === 0) {
      console.log("  ✗ No subjects found in dropdown");
      return [];
    }

    // Filter to single subject if specified
    if (subjectFilter) {
      subjects = subjects.filter((s) => s.startsWith(subjectFilter + "-") || s.startsWith(subjectFilter + " -"));
      if (subjects.length === 0) {
        console.log(`  ✗ Subject ${subjectFilter} not found`);
        return [];
      }
    }

    console.log(`  ${subjects.length} subjects to search`);

    for (let si = 0; si < subjects.length; si++) {
      const subjectLabel = subjects[si];
      const prefix = subjectLabel.split(/[-\s]/)[0];

      process.stdout.write(`  [${si + 1}/${subjects.length}] ${prefix}... `);

      // Navigate back to search page for each subject
      if (si > 0) {
        const reloaded = await navigateToBrowse(page, institutionCode, psTermCode);
        if (!reloaded) {
          console.log("nav failed, skipping");
          continue;
        }
      }

      // Search with retry
      let found = false;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          process.stdout.write(`retry ${attempt}... `);
          await navigateToBrowse(page, institutionCode, psTermCode);
        }
        found = await searchSubject(page, subjectLabel);
        if (found) break;
      }

      if (!found) {
        console.log("0 sections");
        await sleep(INTER_SEARCH_DELAY);
        continue;
      }

      // Extract all pages of results
      let pageNum = 1;
      let subjectSections = 0;

      while (true) {
        const cards = await extractPageCards(page);
        for (const card of cards) {
          const section = rawCardToSection(card, slug, fileTermCode);
          if (section) {
            allSections.push(section);
            subjectSections++;
          }
        }

        // Try next page
        const hasNext = await goToNextPage(page);
        if (!hasNext) break;
        pageNum++;
      }

      console.log(`${subjectSections} sections (${pageNum} page${pageNum > 1 ? "s" : ""})`);
      await sleep(INTER_SEARCH_DELAY);
    }

    console.log(`  ✓ Total: ${allSections.length} sections`);
  } finally {
    await page.close();
  }

  return allSections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { slugs, termName, psTermCode, fileTermCode, subject, headed } = parseArgs();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PeopleSoft Scraper — ${termName}`);
  console.log(`Term code: ${psTermCode} → ${fileTermCode}`);
  console.log(`Colleges: ${slugs.length}`);
  if (subject) console.log(`Subject filter: ${subject}`);
  console.log(`${"=".repeat(60)}\n`);

  const browser = await chromium.launch({ headless: !headed });
  const startTime = Date.now();
  let totalSections = 0;

  try {
    for (const slug of slugs) {
      const sections = await scrapeCollege(browser, slug, psTermCode, fileTermCode, subject);

      if (sections.length > 0) {
        // Save to file
        const dir = path.join(DATA_DIR, slug);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${fileTermCode}.json`);
        fs.writeFileSync(filePath, JSON.stringify(sections, null, 2) + "\n");
        console.log(`  💾 Saved ${sections.length} sections → ${filePath}`);
        totalSections += sections.length;
      }
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done! ${totalSections} total sections across ${slugs.length} college(s) in ${elapsed}s`);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch(console.error);
