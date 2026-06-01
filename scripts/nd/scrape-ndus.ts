/**
 * scrape-ndus.ts — North Dakota University System class search
 *
 * All 11 NDUS schools (incl. 5 community colleges) share one PeopleSoft
 * Campus Solutions tenant ("NDCSPRD") at:
 *   https://studentadmin.connectnd.us/psc/NDCSPRD/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL
 *
 * The 5 NDUS community colleges and their PS Institution codes:
 *   BSC01  Bismarck State College
 *   MISUB  Dakota College at Bottineau
 *   LRSC1  Lake Region State College
 *   NDSCS  North Dakota State College of Science
 *   WSC01  Williston State College
 *
 * Unlike LACCD where one Institution is shared and Campus filters by college,
 * NDUS exposes each college as its own Institution — so we loop institutions
 * × terms × subjects and write per-college files directly (no bucketing).
 *
 * The subject dropdown is institution-scoped: after selecting an Institution,
 * the SUBJECT select repopulates with only that college's subjects. We read
 * the dropdown options dynamically rather than maintain a static list.
 *
 * Usage:
 *   npx tsx scripts/nd/scrape-ndus.ts --term "Spring 2026"
 *   npx tsx scripts/nd/scrape-ndus.ts --term "Spring 2026,Fall 2026"
 *   npx tsx scripts/nd/scrape-ndus.ts --term "Spring 2026" --slug bismarck-state-college
 *   npx tsx scripts/nd/scrape-ndus.ts --term "Spring 2026" --headed
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const PS_URL =
  "https://studentadmin.connectnd.us/psc/NDCSPRD/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";

const NAV_TIMEOUT = 30_000;
const SEARCH_WAIT = 45_000;
const INTER_SEARCH_DELAY = 1000;
const MAX_RETRIES = 2;
const DATA_DIR = path.join(process.cwd(), "data", "nd", "courses");

// Discovered from the live dropdown — verify before adding new terms.
const TERM_CODES: Record<string, string> = {
  "Spring 2026": "2630",
  "Summer 2026": "2640",
  "Fall 2026":   "2710",
  "Spring 2027": "2730",
  "Summer 2027": "2740",
  "Fall 2027":   "2810",
};

const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026":   "2026FA",
  "Spring 2027": "2027SP",
  "Summer 2027": "2027SU",
  "Fall 2027":   "2027FA",
};

// NDUS Institution code → community-college-path slug.
const INSTITUTIONS: Array<{ code: string; slug: string; name: string }> = [
  { code: "BSC01", slug: "bismarck-state-college",            name: "Bismarck State College" },
  { code: "MISUB", slug: "dakota-college-at-bottineau",       name: "Dakota College at Bottineau" },
  { code: "LRSC1", slug: "lake-region-state-college",         name: "Lake Region State College" },
  { code: "NDSCS", slug: "north-dakota-state-college-of-science", name: "North Dakota State College of Science" },
  { code: "WSC01", slug: "williston-state-college",           name: "Williston State College" },
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
  let slugFilter: string | null = null;
  let termArg = "";
  let subject: string | null = null;
  let headed = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termArg = args[i + 1]; i++;
    } else if (args[i] === "--slug" && args[i + 1]) {
      slugFilter = args[i + 1]; i++;
    } else if (args[i] === "--subject" && args[i + 1]) {
      subject = args[i + 1].toUpperCase(); i++;
    } else if (args[i] === "--headed") {
      headed = true;
    }
  }

  if (!termArg) termArg = "Spring 2026,Fall 2026";
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

  const allSlugs = INSTITUTIONS.map((i) => i.slug);
  if (slugFilter && !allSlugs.includes(slugFilter)) {
    console.error(`Unknown slug: ${slugFilter}. NDUS CCs:`);
    for (const s of allSlugs) console.error(`  ${s}`);
    process.exit(1);
  }

  return { slugFilter, terms, subject, headed };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let consecutiveSearchFailures = 0;
const MAX_CONSECUTIVE_SEARCH_FAILURES = 5;

async function navigateToSearch(page: Page): Promise<boolean> {
  try {
    // domcontentloaded — PS keeps issuing AJAX heartbeats which prevent
    // networkidle from ever firing.
    await page.goto(PS_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    return await page
      .locator("#CLASS_SRCH_WRK2_STRM\\$35\\$")
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
  } catch (err) {
    console.error(`    nav failed: ${(err as Error).message}`);
    return false;
  }
}

async function selectInstitution(page: Page, instCode: string): Promise<void> {
  const instSel = page.locator("#CLASS_SRCH_WRK2_INSTITUTION\\$31\\$");
  if ((await instSel.inputValue().catch(() => "")) !== instCode) {
    await instSel.selectOption(instCode);
    // PS reloads subject + career options after institution change — wait
    // for the subject dropdown to repopulate (don't rely on networkidle).
    await sleep(800);
  }
}

async function selectTerm(page: Page, termCode: string): Promise<void> {
  await page.selectOption("#CLASS_SRCH_WRK2_STRM\\$35\\$", termCode);
  await sleep(400);
}

async function getSubjectsForCurrentInstitution(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = document.getElementById("SSR_CLSRCH_WRK_SUBJECT_SRCH$0") as HTMLSelectElement | null;
    if (!sel) return [];
    const out: string[] = [];
    for (const opt of Array.from(sel.options)) {
      const v = opt.value?.trim();
      // Skip the empty placeholder; keep real subject codes
      if (v && v.length > 0) out.push(v);
    }
    return out;
  });
}

async function setSubject(page: Page, subjectCode: string): Promise<boolean> {
  // Returns false if the dropdown doesn't contain this subject (institution-scoped)
  try {
    await page.selectOption("#SSR_CLSRCH_WRK_SUBJECT_SRCH\\$0", subjectCode);
    await sleep(200);
    return true;
  } catch {
    return false;
  }
}

async function clickSearch(page: Page): Promise<SearchOutcome> {
  // Uncheck "open only" if present
  const openOnly = page.locator("#SSR_CLSRCH_WRK_SSR_OPEN_ONLY\\$3");
  if (await openOnly.isChecked().catch(() => false)) {
    await openOnly.uncheck();
    await sleep(300);
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
        text.includes("will exceed the maximum")
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

async function extractResults(page: Page): Promise<RawSection[]> {
  return page.evaluate(() => {
    // RawSection isn't visible inside the browser context here, but the
    // shape matches it exactly — TS narrows the return on the outer side
    // via the function signature.
    const sections: Array<{
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
    }> = [];
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

function determineMode(instrMethod: string, room: string): string {
  const method = instrMethod.toLowerCase();
  const loc = room.toLowerCase();
  if (method.includes("online") || method.includes("web-online")) return "online";
  if (method.includes("hybrid")) return "hybrid";
  if (loc.includes("online") && !loc.match(/online live/i)) return "online";
  if (loc.includes("online live")) return "online";
  if (loc.includes("hybrid")) return "hybrid";
  if (loc.includes("zoom")) return "zoom";
  return "in-person";
}

function parseCredits(sectionType: string): number {
  const m = sectionType.match(/(\d+(?:\.\d+)?)\s*(?:unit|credit)/i);
  return m ? Math.round(parseFloat(m[1])) : 3;
}

function rawToSection(raw: RawSection, slug: string, fileTermCode: string): CourseSection | null {
  if (!raw.classNbr) return null;
  const { prefix, number, title } = parseCourseTitle(raw.courseTitle);
  const { days, startTime, endTime } = parseDayTime(raw.dayTime);
  const startDate = parseDates(raw.dates);
  const mode = determineMode(raw.instrMethod, raw.room);
  const credits = parseCredits(raw.sectionType);
  let instructor: string | null = raw.instructor || null;
  if (instructor && (instructor.toLowerCase() === "staff" || instructor === "-")) instructor = null;
  return {
    college_code: slug,
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

async function scrapeCollegeTerm(
  page: Page,
  inst: { code: string; slug: string; name: string },
  termName: string,
  psTermCode: string,
  fileTermCode: string,
  subjectFilter: string | null,
): Promise<{ sections: CourseSection[]; tooLarge: string[] }> {
  const collected: CourseSection[] = [];
  const tooLarge: string[] = [];

  console.log(`\n  📚 ${inst.name} (${inst.code}) — ${termName}`);

  if (!(await navigateToSearch(page))) {
    console.log(`    nav failed; skipping ${inst.code}/${termName}`);
    return { sections: collected, tooLarge };
  }

  await selectInstitution(page, inst.code);
  await selectTerm(page, psTermCode);

  const allSubjects = await getSubjectsForCurrentInstitution(page);
  const subjects = subjectFilter
    ? allSubjects.filter((s) => s === subjectFilter)
    : allSubjects;

  console.log(`    ${subjects.length} subjects available`);
  if (subjects.length === 0) return { sections: collected, tooLarge };

  for (let si = 0; si < subjects.length; si++) {
    const subjectCode = subjects[si];
    process.stdout.write(`    [${si + 1}/${subjects.length}] ${subjectCode.padEnd(12)} `);

    let outcome: SearchOutcome = "failed";
    let sections: RawSection[] = [];
    const PER_SUBJECT_TIMEOUT = 90_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await Promise.race([
          (async () => {
            // PS Class Search shows the form on first load, then results
            // after search — re-navigate each subject so we always see form.
            await navigateToSearch(page);
            await selectInstitution(page, inst.code);
            await selectTerm(page, psTermCode);
            const subjectSet = await setSubject(page, subjectCode);
            if (!subjectSet) return { outcome: "no-results" as SearchOutcome, secs: [] as RawSection[] };
            const o = await clickSearch(page);
            const s = o === "results" ? await extractResults(page) : [];
            return { outcome: o, secs: s };
          })(),
          new Promise<{ outcome: SearchOutcome; secs: RawSection[] }>((_, rej) =>
            setTimeout(() => rej(new Error(`per-subject timeout ${PER_SUBJECT_TIMEOUT}ms`)), PER_SUBJECT_TIMEOUT),
          ),
        ]);
        outcome = result.outcome;
        sections = result.secs;
        consecutiveSearchFailures = 0;
        break;
      } catch (err) {
        consecutiveSearchFailures++;
        if (consecutiveSearchFailures >= MAX_CONSECUTIVE_SEARCH_FAILURES) {
          throw new Error(`PS search broken — ${consecutiveSearchFailures} consecutive failures`);
        }
      }
    }

    if (outcome === "exceeds-400") {
      tooLarge.push(`${inst.code}/${subjectCode}`);
      console.log("→ skipped (>400)");
    } else if (outcome === "no-results") {
      console.log("→ 0");
    } else if (outcome === "results") {
      let kept = 0;
      for (const raw of sections) {
        const sec = rawToSection(raw, inst.slug, fileTermCode);
        if (sec) { collected.push(sec); kept++; }
      }
      console.log(`→ ${kept}`);
      // Incremental flush — write what we have so any later crash preserves
      // partial progress.
      if (kept > 0) {
        const dir = path.join(DATA_DIR, inst.slug);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `${fileTermCode}.json`),
          JSON.stringify(collected, null, 2) + "\n",
        );
      }
    } else {
      console.log("→ failed");
    }

    await sleep(INTER_SEARCH_DELAY);
  }

  return { sections: collected, tooLarge };
}

async function main() {
  const { slugFilter, terms, subject, headed } = parseArgs();

  const browser = await chromium.launch({ headless: !headed });
  const startTime = Date.now();
  let grandTotal = 0;
  const tooLargeAll: string[] = [];

  try {
    const institutionsToScrape = slugFilter
      ? INSTITUTIONS.filter((i) => i.slug === slugFilter)
      : INSTITUTIONS;

    for (const { termName, psTermCode, fileTermCode } of terms) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`NDUS PeopleSoft Scraper — ${termName}`);
      console.log(`Term code: ${psTermCode} → ${fileTermCode}`);
      console.log(`Colleges: ${institutionsToScrape.map((i) => i.code).join(", ")}`);
      if (subject) console.log(`Subject filter: ${subject}`);
      console.log(`${"=".repeat(60)}`);

      for (const inst of institutionsToScrape) {
        const page = await browser.newPage();
        page.setDefaultTimeout(NAV_TIMEOUT);

        try {
          const { sections, tooLarge } = await scrapeCollegeTerm(
            page, inst, termName, psTermCode, fileTermCode, subject,
          );
          tooLargeAll.push(...tooLarge);

          if (sections.length > 0) {
            const dir = path.join(DATA_DIR, inst.slug);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, `${fileTermCode}.json`);
            fs.writeFileSync(filePath, JSON.stringify(sections, null, 2) + "\n");
            console.log(`    ✓ wrote ${sections.length} sections → ${path.relative(process.cwd(), filePath)}`);
            grandTotal += sections.length;
          } else {
            console.log(`    (no sections for ${inst.slug}/${fileTermCode})`);
          }
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done! ${grandTotal} sections across NDUS CCs, ${terms.length} term(s) in ${elapsed}s`);
  if (tooLargeAll.length > 0) {
    console.log(`\n⚠ Subjects exceeding 400 sections (skipped):\n  ${tooLargeAll.join("\n  ")}`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
