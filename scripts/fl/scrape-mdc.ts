/**
 * scrape-mdc.ts — Miami Dade College class search
 *
 * MDC publishes anonymous "Community Access" class search at
 *   https://findclasses.mdc.edu/psc/PMYM1J/CUSTOMER/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL
 *
 * Single institution (MDC01) covering all 8 MDC campuses (Wolfson, North,
 * Kendall, Padron, Homestead, West, Hialeah, Medical). We store everything
 * under data/fl/courses/mdc/ — the campus is preserved on each section so the
 * UI can still filter by campus when needed.
 *
 * Differences from the LACCD template:
 *   • No Academic Career dropdown — MDC's deployment doesn't expose one.
 *   • Subject is a plain <select> (not the input+lookup-glass pattern).
 *   • Open-Only checkbox is at $4 (vs LACCD's $3).
 *   • PS rejects single-criterion searches with "Select at least 2 search
 *     criteria." Subject alone fails; we add Catalog Nbr ≥ 1 as a no-op
 *     second criterion that matches every section.
 *   • Use psc/ (content frame) directly — psp/ wraps the form in a
 *     TargetContent iframe and the selectors below would not resolve.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-mdc.ts --term "Fall 2026"
 *   npx tsx scripts/fl/scrape-mdc.ts --term "Summer 2026,Fall 2026"
 *   npx tsx scripts/fl/scrape-mdc.ts --term "Fall 2026" --subject MAC
 *   npx tsx scripts/fl/scrape-mdc.ts --term "Fall 2026" --headed
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const PS_URL =
  "https://findclasses.mdc.edu/psc/PMYM1J/CUSTOMER/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?FolderPath=PORTAL_ROOT_OBJECT.CO_EMPLOYEE_SELF_SERVICE.HC_CLASS_SEARCH_GBL&IsFolder=false&IgnoreParamTempl=FolderPath,IsFolder";

const COLLEGE_SLUG = "mdc";
const INSTITUTION = "MDC01";
const NAV_TIMEOUT = 30_000;
const SEARCH_WAIT = 45_000;
const INTER_SEARCH_DELAY = 1000;
const MAX_RETRIES = 2;
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

const TERM_CODES: Record<string, string> = {
  "Spring 2026": "2263",
  "Summer 2026": "2265",
  "Fall 2026":   "2267",
  "Spring 2027": "2273",
};

const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026":   "2026FA",
  "Spring 2027": "2027SP",
};

// All 198 subject codes from MDC's PS subject dropdown (captured 2026-05-29).
const MDC_SUBJECTS = [
  "ABX","ACG","AFR","AMH","AML","ANT","ARC","ARH","ART","ASC","ASL","AST","ATE","ATF","ATT","AVM",
  "BAN","BCH","BCN","BCT","BOT","BSC","BUL",
  "CAI","CAP","CCJ","CEN","CET","CGS","CHI","CHM","CHS","CIS","CJC","CJE","CJJ","CJK","CJL","CLP","CNT","COP","COT","CPO","CRW","CTE","CTS",
  "DAA","DAN","DEA","DEH","DEP","DES","DIG","DSC",
  "EAP","ECO","EDF","EDG","EDU","EEC","EET","EEX","EGN","EGS","EME","EMS","ENC","ENG","ENL","ENT","EPI","ESC","ETD","ETI","ETP","ETS","EUH","EVR",
  "FFP","FIL","FIN","FOT","FRE","FSE","FSS",
  "GEB","GER","GIS","GLY","GRA",
  "HFT","HIM","HLP","HOS","HSA","HSC","HUM","HUN","HUS",
  "IDH","IDS","IND","INP","INR","INT","IPM","ISM","ISS","ITA",
  "JOU","JPN",
  "LAE","LDE","LIN","LIS","LIT",
  "MAC","MAD","MAE","MAN","MAP","MAR","MAS","MAT","MCB","MEA","MET","MGF","MKA","MLS","MLT","MMC","MNA","MSL","MSS","MTB","MTG","MUC","MUH","MUL","MUM","MUN","MUO","MUS","MUT","MVB","MVJ","MVK","MVP","MVS","MVV","MVW",
  "NMT","NSP","NUR",
  "OCE","OPT","ORH","OST",
  "PAS","PCB","PGY","PHI","PHT","PHY","PLA","POR","POS","PRN","PSB","PSC","PSY","PTN","PUR",
  "QMB",
  "RAT","REA","RED","REE","REL","RET","RTE","RTV","RUS","RVST",
  "SBM","SCE","SCY","SLS","SOJD","SON","SOP","SPC","SPM","SPN","STA","STS","SUR","SYG",
  "TAX","THE","TPA","TPP","TRA","TSL",
  "VIC",
  "WOH",
  "ZOO",
];

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

interface ParsedTerm {
  termName: string;
  psTermCode: string;
  fileTermCode: string;
}

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

type SearchOutcome = "results" | "no-results" | "exceeds-400" | "failed";

function parseArgs() {
  const args = process.argv.slice(2);
  let termArg = "";
  let subject: string | null = null;
  let headed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
    else if (args[i] === "--subject" && args[i + 1]) { subject = args[i + 1].toUpperCase(); i++; }
    else if (args[i] === "--headed") { headed = true; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
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
  return { terms, subject, headed };
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

let consecutiveSearchFailures = 0;
const MAX_CONSECUTIVE_SEARCH_FAILURES = 5;

async function navigateToSearch(page: Page): Promise<boolean> {
  try {
    await page.goto(PS_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await sleep(1200);
    return await page
      .locator("select[id^='CLASS_SRCH_WRK2_STRM']")
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
  } catch (err) {
    console.error(`    ⚠ Nav failed: ${(err as Error).message}`);
    return false;
  }
}

async function applyCommonCriteria(page: Page, termCode: string): Promise<void> {
  const instSel = page.locator("select[id^='CLASS_SRCH_WRK2_INSTITUTION']").first();
  if ((await instSel.inputValue().catch(() => "")) !== INSTITUTION) {
    await instSel.selectOption(INSTITUTION);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }
  await page.locator("select[id^='CLASS_SRCH_WRK2_STRM']").first().selectOption(termCode);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

async function setSubject(page: Page, subjectCode: string): Promise<void> {
  await page.locator("select[id^='SSR_CLSRCH_WRK_SUBJECT_SRCH']").first().selectOption(subjectCode);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

// MDC's PS requires "at least 2 search criteria". Subject alone is rejected;
// add "Course Number ≤ 9999" as a no-op second criterion (matches everything).
// ORDER MATTERS: fill the value FIRST via native typing, THEN switch the
// operator dropdown by label. The reverse order (operator first) loses the
// operator change to an AJAX re-render, leaving "is exactly" + value, which
// returns 0 results.
async function setCatalogNbrLteAll(page: Page): Promise<void> {
  const catInput = page.locator("input[id^='SSR_CLSRCH_WRK_CATALOG_NBR']").first();
  await catInput.click();
  await catInput.type("9999", { delay: 30 });
  await catInput.press("Tab");
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.locator("select[id^='SSR_CLSRCH_WRK_SSR_EXACT_MATCH1']").first()
    .selectOption({ label: "less than or equal to" });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

async function clickSearch(page: Page): Promise<SearchOutcome> {
  const openOnly = page.locator("input[id^='SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk']").first();
  if (await openOnly.isChecked().catch(() => false)) {
    await openOnly.uncheck();
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  }

  await page.click("#CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH");

  await page.waitForFunction(
    () => {
      const text = document.body?.innerText || "";
      return (
        text.includes("class section(s) found") ||
        text.includes("search returns no results") ||
        text.includes("no results that match") ||
        text.includes("would you like to continue") ||
        text.includes("will exceed the maximum") ||
        text.includes("Select at least 2 search criteria")
      );
    },
    { timeout: SEARCH_WAIT }
  );

  await sleep(400);
  let bodyText = await page.evaluate(() => document.body?.innerText || "");

  if (bodyText.includes("will exceed the maximum")) return "exceeds-400";

  if (bodyText.includes("would you like to continue")) {
    await page.evaluate(() => {
      const ok = document.querySelector('input[id="#ICSave"]') as HTMLInputElement | null;
      if (ok) ok.click();
    });
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          text.includes("class section(s) found") ||
          text.includes("search returns no results")
        );
      },
      { timeout: 60_000 }
    );
    await sleep(600);
    bodyText = await page.evaluate(() => document.body?.innerText || "");
  }

  if (bodyText.includes("class section(s) found")) return "results";
  if (bodyText.includes("no results") || bodyText.includes("returns no results")) return "no-results";
  return "failed";
}

async function search(page: Page, subjectCode: string, termCode: string): Promise<SearchOutcome> {
  try {
    await applyCommonCriteria(page, termCode);
    await setSubject(page, subjectCode);
    await setCatalogNbrLteAll(page);
    const out = await clickSearch(page);
    consecutiveSearchFailures = 0;
    return out;
  } catch (err) {
    consecutiveSearchFailures++;
    console.error(
      `    ⚠ Search failed (${consecutiveSearchFailures}/${MAX_CONSECUTIVE_SEARCH_FAILURES}): ${(err as Error).message}`
    );
    if (consecutiveSearchFailures >= MAX_CONSECUTIVE_SEARCH_FAILURES) {
      throw new Error(`PS search broken — ${consecutiveSearchFailures} consecutive failures. Aborting.`);
    }
    return "failed";
  }
}

async function extractResults(page: Page): Promise<RawSection[]> {
  return page.evaluate(() => {
    const sections: RawSection[] = [];
    const courseTitles: string[] = [];
    for (let i = 0; ; i++) {
      const el = document.getElementById(`win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$${i}`);
      if (!el) break;
      courseTitles.push((el as HTMLElement).innerText?.trim() || "");
    }

    let m = 0;
    while (true) {
      const classNbrEl = document.getElementById(`MTG_CLASS_NBR$${m}`);
      if (!classNbrEl) break;

      let courseTitle = "";
      const sectionEl = document.getElementById(`win0divSSR_CLSRSLT_WRK_GROUPBOX3$${m}`);
      if (sectionEl) {
        let parent: HTMLElement | null = sectionEl.parentElement;
        while (parent) {
          if (parent.id?.startsWith("win0divSSR_CLSRSLT_WRK_GROUPBOX2$")) {
            const idx = parseInt(parent.id.split("$")[1]);
            if (!isNaN(idx) && idx < courseTitles.length) courseTitle = courseTitles[idx];
            break;
          }
          parent = parent.parentElement;
        }
      }

      const statusEl = document.getElementById(`win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${m}`);
      const statusImg = statusEl?.querySelector("img");

      sections.push({
        courseTitle,
        classNbr: (classNbrEl as HTMLElement).innerText?.trim() || "",
        sectionType: (document.getElementById(`MTG_CLASSNAME$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        dayTime: (document.getElementById(`MTG_DAYTIME$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        campus: (document.getElementById(`DERIVED_CLSRCH_DESCR4$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        room: (document.getElementById(`MTG_ROOM$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        instructor: (document.getElementById(`MTG_INSTR$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        dates: (document.getElementById(`MTG_TOPIC$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        instrMethod: (document.getElementById(`DERIVED_CLSRCH_DESCR5$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        isOpen: statusImg?.getAttribute("alt") !== "Closed",
      });
      m++;
    }
    return sections;
  });
}

function parseCourseTitle(raw: string): { prefix: string; number: string; title: string } {
  const m = raw.match(/^([A-Z][A-Z &/]{1,10}?)\s+(\d{1,4}[A-Z]{0,3})\s*[-–—]\s*(.+)$/);
  if (m) return { prefix: m[1].trim(), number: m[2], title: m[3].trim() };
  const parts = raw.split(/\s+/);
  return { prefix: parts[0] || "UNK", number: parts[1] || "000", title: parts.slice(2).join(" ") };
}

function parseDayTime(raw: string): { days: string; startTime: string; endTime: string } {
  if (!raw || raw === "TBA" || raw.toLowerCase().includes("tba")) {
    return { days: "", startTime: "", endTime: "" };
  }
  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/);
  if (m) return { days: m[1], startTime: m[2].trim(), endTime: m[3].trim() };
  const daysOnly = raw.match(/^([A-Za-z]+)$/);
  if (daysOnly) return { days: daysOnly[1], startTime: "", endTime: "" };
  return { days: "", startTime: "", endTime: "" };
}

function parseDates(raw: string): string {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return "";
}

function determineMode(instrMethod: string, room: string, campus: string): string {
  const method = instrMethod.toLowerCase();
  const loc = room.toLowerCase();
  const cmp = campus.toLowerCase();
  if (method.includes("online") || method.includes("web-")) return "online";
  if (method.includes("hybrid")) return "hybrid";
  if (loc.includes("online") || cmp.includes("online") || cmp.includes("virtual")) return "online";
  if (loc.includes("hybrid")) return "hybrid";
  return "in-person";
}

function parseCredits(sectionType: string): number {
  const m = sectionType.match(/(\d+(?:\.\d+)?)\s*(?:unit|credit)/i);
  return m ? Math.round(parseFloat(m[1])) : 3;
}

function rawToSection(raw: RawSection, fileTermCode: string): CourseSection | null {
  if (!raw.classNbr) return null;
  const { prefix, number, title } = parseCourseTitle(raw.courseTitle);
  const { days, startTime, endTime } = parseDayTime(raw.dayTime);
  const startDate = parseDates(raw.dates);
  const mode = determineMode(raw.instrMethod, raw.room, raw.campus);
  const credits = parseCredits(raw.sectionType);
  let instructor: string | null = raw.instructor || null;
  if (instructor && (instructor.toLowerCase() === "staff" || instructor === "-")) instructor = null;
  return {
    college_code: COLLEGE_SLUG,
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

async function scrapeTerm(
  browser: Browser,
  termName: string,
  psTermCode: string,
  fileTermCode: string,
  subjectFilter: string | null,
): Promise<{ sections: CourseSection[]; tooLarge: string[] }> {
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  const sections: CourseSection[] = [];
  const tooLarge: string[] = [];
  try {
    console.log(`\nMDC - ${termName} (PS ${psTermCode})`);
    const subjects = subjectFilter ? [subjectFilter] : MDC_SUBJECTS;
    console.log(`  ${subjects.length} subjects to scan`);

    for (let si = 0; si < subjects.length; si++) {
      const subjectCode = subjects[si];
      process.stdout.write(`  [${si + 1}/${subjects.length}] ${subjectCode.padEnd(6)} `);

      let outcome: SearchOutcome = "failed";
      let raws: RawSection[] = [];
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        await navigateToSearch(page);
        outcome = await search(page, subjectCode, psTermCode);
        if (outcome === "results") {
          raws = await extractResults(page);
          break;
        }
        if (outcome !== "failed") break;
      }

      if (outcome === "exceeds-400") {
        tooLarge.push(subjectCode);
        console.log("-> skipped (>400)");
      } else if (outcome === "no-results") {
        console.log("-> 0");
      } else if (outcome !== "results") {
        console.log("-> failed");
      } else {
        let kept = 0;
        for (const r of raws) {
          const s = rawToSection(r, fileTermCode);
          if (s) { sections.push(s); kept++; }
        }
        console.log(`-> ${kept}`);
      }

      // Incremental save every 25 subjects so a crash mid-run preserves work.
      if ((si + 1) % 25 === 0 && sections.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmpPath = path.join(DATA_DIR, `${fileTermCode}.partial.json`);
        fs.writeFileSync(tmpPath, JSON.stringify(sections, null, 2) + "\n");
      }

      await sleep(INTER_SEARCH_DELAY);
    }
  } finally {
    await page.close();
  }
  return { sections, tooLarge };
}

async function main() {
  const { terms, subject, headed } = parseArgs();
  const browser = await chromium.launch({ headless: !headed });
  const startTime = Date.now();
  let grandTotal = 0;
  const tooLargeAll: Record<string, string[]> = {};
  try {
    for (const { termName, psTermCode, fileTermCode } of terms) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`MDC PeopleSoft Scraper - ${termName}`);
      console.log(`Term code: ${psTermCode} -> ${fileTermCode}`);
      if (subject) console.log(`Subject filter: ${subject}`);
      console.log(`${"=".repeat(60)}`);

      const { sections, tooLarge } = await scrapeTerm(browser, termName, psTermCode, fileTermCode, subject);
      if (tooLarge.length > 0) tooLargeAll[termName] = tooLarge;

      if (sections.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const filePath = path.join(DATA_DIR, `${fileTermCode}.json`);
        fs.writeFileSync(filePath, JSON.stringify(sections, null, 2) + "\n");
        const partial = path.join(DATA_DIR, `${fileTermCode}.partial.json`);
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
      }
      console.log(`\n  ${termName} total: ${sections.length}`);
      grandTotal += sections.length;
    }
  } finally {
    await browser.close();
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done! ${grandTotal} sections across ${terms.length} term(s) in ${elapsed}s`);
  if (Object.keys(tooLargeAll).length > 0) {
    console.log(`\nSubjects exceeding 400-section limit:`);
    for (const [t, subs] of Object.entries(tooLargeAll)) {
      console.log(`  ${t}: ${subs.join(", ")}`);
    }
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
