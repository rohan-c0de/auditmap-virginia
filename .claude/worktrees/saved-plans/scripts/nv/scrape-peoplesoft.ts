/**
 * scrape-peoplesoft.ts — NSHE PeopleSoft class search scraper
 *
 * All 4 Nevada community colleges share a single PeopleSoft instance at
 * mycolleges.shr.nevada.edu with standard Community Access class search.
 *
 * Usage:
 *   npx tsx scripts/nv/scrape-peoplesoft.ts --term "Fall 2026"
 *   npx tsx scripts/nv/scrape-peoplesoft.ts --term "Fall 2026" --slug college-of-southern-nevada
 *   npx tsx scripts/nv/scrape-peoplesoft.ts --term "Summer 2026,Fall 2026" --headed
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PS_BASE = "https://mycolleges.shr.nevada.edu/psc/spcssprd";
const NAV_TIMEOUT = 30_000;
const SEARCH_WAIT = 30_000;
const INTER_SEARCH_DELAY = 2000;
const MAX_RETRIES = 2;
const DATA_DIR = path.join(process.cwd(), "data", "nv", "courses");

const TERM_CODES: Record<string, string> = {
  "Spring 2026": "2262",
  "Summer 2026": "2265",
  "Fall 2026": "2268",
  "Spring 2027": "2272",
};

const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026": "2026FA",
  "Spring 2027": "2027SP",
};

interface CollegePS {
  portal: string;
  institution: string;
}

const PS_CODES: Record<string, CollegePS> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "nv", "peoplesoft-codes.json"), "utf-8")
);
delete (PS_CODES as Record<string, unknown>)["_comment"];
delete (PS_CODES as Record<string, unknown>)["_url_pattern"];

let consecutiveSearchFailures = 0;
const MAX_CONSECUTIVE_SEARCH_FAILURES = 5;

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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface ParsedTerm {
  termName: string;
  psTermCode: string;
  fileTermCode: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let slugs: string[] = Object.keys(PS_CODES);
  let termArg = "";
  let subject: string | null = null;
  let headed = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termArg = args[i + 1];
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

  if (!termArg) {
    console.error('Error: --term is required. Example: --term "Fall 2026"');
    console.error("Available terms:", Object.keys(TERM_CODES).join(", "));
    process.exit(1);
  }

  const termNames = termArg.split(",").map((t) => t.trim()).filter(Boolean);
  const terms: ParsedTerm[] = [];
  for (const termName of termNames) {
    const psTermCode = TERM_CODES[termName];
    const fileTermCode = TERM_FILE_CODES[termName];
    if (!psTermCode || !fileTermCode) {
      console.error(`Unknown term: "${termName}". Available:`, Object.keys(TERM_CODES).join(", "));
      process.exit(1);
    }
    terms.push({ termName, psTermCode, fileTermCode });
  }

  for (const s of slugs) {
    if (!PS_CODES[s]) {
      console.error(`Unknown slug: ${s}. Available: ${Object.keys(PS_CODES).join(", ")}`);
      process.exit(1);
    }
  }

  return { slugs, terms, subject, headed };
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

function buildUrl(portal: string): string {
  return `${PS_BASE}/${portal}/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL`;
}

async function navigateToSearch(page: Page, portal: string): Promise<boolean> {
  try {
    await page.goto(buildUrl(portal), {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT,
    });
    await sleep(2000);
    const hasForm = await page
      .locator("#CLASS_SRCH_WRK2_STRM\\$35\\$")
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    return hasForm;
  } catch (err) {
    console.error(`    ⚠ Nav failed: ${(err as Error).message}`);
    return false;
  }
}

// Common NSHE subject codes — covers all 4 NV community colleges.
// Missing subjects silently return 0 results, so over-listing is harmless.
const NSHE_SUBJECTS = [
  "ACC", "AHS", "ANTH", "ARC", "ART", "ASL", "AST", "AT", "AUTO",
  "BIOL", "BIS", "BMGT", "BUS",
  "CHEM", "CIS", "CIT", "CJE", "CJL", "COM", "CONS", "CPD", "CRJ", "CS", "CUL",
  "DANC", "DAS", "DH", "DMS", "DRFT",
  "ECON", "EDU", "EE", "EGG", "EGR", "ELCT", "EME", "EMS", "ENG", "ENV", "EPT", "EPY", "ESL",
  "FILM", "FIN", "FIRE", "FREN",
  "GEOG", "GEOL", "GIS", "GRC",
  "HIST", "HIT", "HMGT", "HPE", "HRT", "HUM",
  "IDS", "IS", "ISYS",
  "JPN", "JOUR",
  "LAW", "LIB",
  "MATH", "MCB", "MGT", "MKT", "MLP", "MPHY", "MUS",
  "NRES", "NURS", "NUTR",
  "OAT", "OPTK",
  "PEX", "PHIL", "PHYS", "POL", "PRNT", "PSC", "PSY",
  "RADN", "RE", "READ", "RT",
  "SOC", "SPAN", "SPEC", "SPTM", "STAT", "SURG",
  "THTR", "TRVL",
  "VET",
  "WELD", "WMST",
];

function getSubjectCodes(): string[] {
  return NSHE_SUBJECTS;
}

async function searchSubject(
  page: Page,
  subjectCode: string,
  termCode: string,
  _portal: string,
): Promise<boolean> {
  try {
    // Set term
    await page.selectOption("#CLASS_SRCH_WRK2_STRM\\$35\\$", termCode);
    await sleep(1000);

    // Set subject — use click + keyboard input to trigger PS event handlers
    const subjectInput = page.locator("#SSR_CLSRCH_WRK_SUBJECT\\$0");
    await subjectInput.click();
    await subjectInput.fill("");
    await sleep(200);
    await subjectInput.type(subjectCode, { delay: 50 });
    await sleep(300);

    // Set exact match
    await page.selectOption("#SSR_CLSRCH_WRK_SSR_EXACT_MATCH1\\$1", "E");
    await sleep(300);

    // Uncheck "open classes only" to get all sections
    const openOnly = page.locator("#SSR_CLSRCH_WRK_SSR_OPEN_ONLY\\$3");
    if (await openOnly.isChecked().catch(() => false)) {
      await openOnly.uncheck();
      await sleep(300);
    }

    // Click search
    await page.click("#CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH");

    // Wait for: results on page, modal mask visible, or no-results text
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        const modalMask = document.getElementById("pt_modalMask");
        const modalVisible = modalMask && window.getComputedStyle(modalMask).display !== "none";
        return (
          text.includes("class section(s) found") ||
          text.includes("The search returns no results") ||
          text.includes("no results that match") ||
          text.includes("additional selection criteria") ||
          modalVisible
        );
      },
      { timeout: SEARCH_WAIT }
    );

    consecutiveSearchFailures = 0;
    await sleep(1000);

    // Handle PS confirmation modal ("over 250 classes" etc.) —
    // modal content lives inside iframe ptModFrame_0; click #ICSave via evaluate
    const modalVisible = await page.evaluate(() => {
      const m = document.getElementById("pt_modalMask");
      return m ? window.getComputedStyle(m).display !== "none" : false;
    });

    if (modalVisible) {
      // Check if this is a "no results" modal or a "over 250" confirmation
      const modalType = await page.evaluate(() => {
        try {
          const iframe = document.getElementById("ptModFrame_0") as HTMLIFrameElement;
          const text = iframe?.contentDocument?.body?.innerText || "";
          if (text.includes("no results") || text.includes("search returns no results")) return "no-results";
          if (text.includes("250") || text.includes("continue")) return "confirm";
          if (text.includes("additional selection criteria") || text.includes("2 search criteria")) return "need-criteria";
          return "unknown";
        } catch { return "unknown"; }
      });

      if (modalType === "no-results" || modalType === "need-criteria") {
        // Dismiss the modal and return false
        await page.evaluate(() => {
          const iframe = document.getElementById("ptModFrame_0") as HTMLIFrameElement;
          const doc = iframe?.contentDocument;
          if (!doc) return;
          const btn = doc.getElementById("#ICSave") || doc.getElementById("#ICOK");
          if (btn) (btn as HTMLElement).click();
        });
        await sleep(1500);
        return false;
      }

      // "Over 250" confirmation — click OK and wait for results
      await page.evaluate(() => {
        const iframe = document.getElementById("ptModFrame_0") as HTMLIFrameElement;
        const btn = iframe?.contentDocument?.getElementById("#ICSave");
        if (btn) (btn as HTMLElement).click();
      });
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText || "";
          return (
            text.includes("class section(s) found") ||
            text.includes("The search returns no results")
          );
        },
        { timeout: 60_000 }
      );
      await sleep(1500);
    }

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (
      bodyText.includes("no results") ||
      bodyText.includes("additional selection criteria")
    ) {
      return false;
    }

    return bodyText.includes("class section(s) found");
  } catch (err) {
    consecutiveSearchFailures++;
    console.error(
      `    ⚠ Search failed (${consecutiveSearchFailures}/${MAX_CONSECUTIVE_SEARCH_FAILURES}): ${(err as Error).message}`
    );
    if (consecutiveSearchFailures >= MAX_CONSECUTIVE_SEARCH_FAILURES) {
      throw new Error(
        `PeopleSoft search appears systemically broken — ${consecutiveSearchFailures} consecutive failures. Aborting.`
      );
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

interface RawSection {
  courseTitle: string;
  classNbr: string;
  sectionType: string;
  dayTime: string;
  campus: string;
  room: string;
  instructor: string;
  dates: string;
  instrMethod: string;
  isOpen: boolean;
}

async function extractResults(page: Page): Promise<RawSection[]> {
  return page.evaluate(() => {
    const sections: {
      courseTitle: string;
      classNbr: string;
      sectionType: string;
      dayTime: string;
      campus: string;
      room: string;
      instructor: string;
      dates: string;
      instrMethod: string;
      isOpen: boolean;
    }[] = [];

    // Build course title list from groups
    const courseTitles: string[] = [];
    for (let i = 0; ; i++) {
      const el = document.getElementById(`win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$${i}`);
      if (!el) break;
      courseTitles.push(el.innerText?.trim() || "");
    }

    // Extract sections — M is sequential across all course groups.
    // Walk up from each GROUPBOX3 to find the parent GROUPBOX2 index.
    let m = 0;
    while (true) {
      const classNbrEl = document.getElementById(`MTG_CLASS_NBR$${m}`);
      if (!classNbrEl) break;

      // Find parent course group by walking up from the section's container
      let courseTitle = "";
      const sectionEl = document.getElementById(`win0divSSR_CLSRSLT_WRK_GROUPBOX3$${m}`);
      if (sectionEl) {
        let parent = sectionEl.parentElement;
        while (parent) {
          if (parent.id?.startsWith("win0divSSR_CLSRSLT_WRK_GROUPBOX2$")) {
            const idx = parseInt(parent.id.split("$")[1]);
            if (!isNaN(idx) && idx < courseTitles.length) {
              courseTitle = courseTitles[idx];
            }
            break;
          }
          parent = parent.parentElement;
        }
      }

      const statusEl = document.getElementById(
        `win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${m}`
      );
      const statusImg = statusEl?.querySelector("img");

      sections.push({
        courseTitle,
        classNbr: classNbrEl.innerText?.trim() || "",
        sectionType: document.getElementById(`MTG_CLASSNAME$${m}`)?.innerText?.trim() || "",
        dayTime: document.getElementById(`MTG_DAYTIME$${m}`)?.innerText?.trim() || "",
        campus: document.getElementById(`DERIVED_CLSRCH_DESCR4$${m}`)?.innerText?.trim() || "",
        room: document.getElementById(`MTG_ROOM$${m}`)?.innerText?.trim() || "",
        instructor: document.getElementById(`MTG_INSTR$${m}`)?.innerText?.trim() || "",
        dates: document.getElementById(`MTG_TOPIC$${m}`)?.innerText?.trim() || "",
        instrMethod: document.getElementById(`DERIVED_CLSRCH_DESCR5$${m}`)?.innerText?.trim() || "",
        isOpen: statusImg?.alt !== "Closed",
      });

      m++;
    }

    return sections;
  });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseCourseTitle(raw: string): {
  prefix: string;
  number: string;
  title: string;
} {
  // "ACC 105 - Taxation for Individuals"
  const m = raw.match(/^([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)\s*[-–—]\s*(.+)$/);
  if (m) return { prefix: m[1], number: m[2], title: m[3].trim() };
  const parts = raw.split(/\s+/);
  return {
    prefix: parts[0] || "UNK",
    number: parts[1] || "000",
    title: parts.slice(2).join(" "),
  };
}

function parseDayTime(raw: string): {
  days: string;
  startTime: string;
  endTime: string;
} {
  if (!raw || raw === "TBA" || raw.toLowerCase().includes("tba")) {
    return { days: "", startTime: "", endTime: "" };
  }

  // "MoWe 11:00AM - 12:20PM" or "TuTh 6:00PM - 7:15PM"
  const m = raw.match(
    /^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/
  );
  if (m) {
    return {
      days: m[1],
      startTime: m[2].trim(),
      endTime: m[3].trim(),
    };
  }

  // Just days, no times
  const daysOnly = raw.match(/^([A-Za-z]+)$/);
  if (daysOnly) {
    return { days: daysOnly[1], startTime: "", endTime: "" };
  }

  return { days: "", startTime: "", endTime: "" };
}

function parseDates(raw: string): string {
  // "01/20/2026 - 05/17/2026" → "2026-01-20"
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return "";
}

function determineMode(instrMethod: string, room: string, campus: string): string {
  const method = instrMethod.toLowerCase();
  const loc = (room + " " + campus).toLowerCase();

  if (method.includes("web-online") || method.includes("online")) return "online";
  if (method.includes("hybrid")) return "hybrid";
  if (loc.includes("online") || loc.includes("web-online")) return "online";
  if (loc.includes("hybrid")) return "hybrid";
  if (method.includes("in person") || method.includes("in-person")) return "in-person";
  if (loc.includes("zoom")) return "zoom";
  return "in-person";
}

function parseCredits(sectionType: string): number {
  // Section type might contain credit info; default to 3
  const m = sectionType.match(/(\d+(?:\.\d+)?)\s*(?:unit|credit)/i);
  return m ? Math.round(parseFloat(m[1])) : 3;
}

function rawToSection(
  raw: RawSection,
  collegeSlug: string,
  fileTermCode: string,
): CourseSection | null {
  if (!raw.classNbr) return null;

  const { prefix, number, title } = parseCourseTitle(raw.courseTitle);
  const { days, startTime, endTime } = parseDayTime(raw.dayTime);
  const startDate = parseDates(raw.dates);
  const mode = determineMode(raw.instrMethod, raw.room, raw.campus);
  const credits = parseCredits(raw.sectionType);

  let instructor: string | null = raw.instructor || null;
  if (instructor && (instructor.toLowerCase() === "staff" || instructor === "-")) {
    instructor = null;
  }

  return {
    college_code: collegeSlug,
    term: fileTermCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: raw.classNbr,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: startDate,
    location: raw.room,
    campus: raw.campus,
    mode,
    instructor,
    seats_open: raw.isOpen ? 1 : 0,
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
  subjectFilter: string | null,
): Promise<CourseSection[]> {
  const { portal } = PS_CODES[slug];
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const allSections: CourseSection[] = [];

  try {
    console.log(`\n📚 ${slug} (${portal})`);

    const loaded = await navigateToSearch(page, portal);
    if (!loaded) {
      console.log("  ✗ Could not load search page");
      return [];
    }

    // Get subjects
    let subjects: string[];
    if (subjectFilter) {
      subjects = [subjectFilter];
    } else {
      subjects = getSubjectCodes();
    }

    console.log(`  ${subjects.length} subjects to search`);

    for (let si = 0; si < subjects.length; si++) {
      const subjectCode = subjects[si];
      process.stdout.write(
        `  [${si + 1}/${subjects.length}] ${subjectCode}... `
      );

      // Reload search form for each subject (PS form state is fragile)
      if (si > 0) {
        const reloaded = await navigateToSearch(page, portal);
        if (!reloaded) {
          console.log("nav failed, skipping");
          continue;
        }
      }

      let found = false;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          process.stdout.write(`retry ${attempt}... `);
          await navigateToSearch(page, portal);
        }
        found = await searchSubject(page, subjectCode, psTermCode, portal);
        if (found) break;
      }

      if (!found) {
        console.log("0 sections");
        await sleep(INTER_SEARCH_DELAY);
        continue;
      }

      const rawSections = await extractResults(page);
      let subjectSections = 0;

      for (const raw of rawSections) {
        const section = rawToSection(raw, slug, fileTermCode);
        if (section) {
          allSections.push(section);
          subjectSections++;
        }
      }

      console.log(`${subjectSections} sections`);
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
  const { slugs, terms, subject, headed } = parseArgs();

  const browser = await chromium.launch({ headless: !headed });
  const startTime = Date.now();
  let grandTotal = 0;

  try {
    for (const { termName, psTermCode, fileTermCode } of terms) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`NSHE PeopleSoft Scraper — ${termName}`);
      console.log(`Term code: ${psTermCode} → ${fileTermCode}`);
      console.log(`Colleges: ${slugs.length}`);
      if (subject) console.log(`Subject filter: ${subject}`);
      console.log(`${"=".repeat(60)}\n`);

      let totalSections = 0;
      for (const slug of slugs) {
        const sections = await scrapeCollege(
          browser,
          slug,
          psTermCode,
          fileTermCode,
          subject,
        );

        if (sections.length > 0) {
          const dir = path.join(DATA_DIR, slug);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `${fileTermCode}.json`);
          fs.writeFileSync(filePath, JSON.stringify(sections, null, 2) + "\n");
          console.log(`  💾 Saved ${sections.length} sections → ${filePath}`);
          totalSections += sections.length;
        }
      }
      console.log(`  ${termName}: ${totalSections} sections`);
      grandTotal += totalSections;
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Done! ${grandTotal} total sections across ${slugs.length} college(s), ${terms.length} term(s) in ${elapsed}s`,
  );
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
